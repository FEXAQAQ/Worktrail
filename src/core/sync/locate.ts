/**
 * 找出 session 的紀錄檔，以及 MCP 呼叫未帶 session_id 時的對應規則（規格 7.2）。
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath } from '../capture/project.js';
import { claudeHome, type StoragePaths } from '../storage/paths.js';
import { readState } from '../storage/state.js';
import { pendingToolUses } from '../transcript/index.js';

/** Claude Code 以工作目錄命名專案資料夾：非英數字元一律換成 '-' */
export const encodeProjectDir = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-');

export function projectsDir(): string {
  return join(claudeHome(), 'projects');
}

export function findTranscriptPath(paths: StoragePaths, sessionId: string, cwd?: string): string | null {
  const known = readState(paths).sessions[sessionId]?.transcript_path;
  if (known && existsSync(known)) return known;
  const root = projectsDir();
  if (cwd) {
    const p = join(root, encodeProjectDir(cwd), `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root)) {
    const p = join(root, d, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

export class SessionResolveError extends Error {}

const RECENT_MS = 10 * 60_000;
/** 只看檔尾這麼多位元組：剛寫入、尚未回覆的工具呼叫一定在最後面 */
const TAIL_BYTES = 256 * 1024;

function readTail(path: string, bytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * 找出正在呼叫某個 MCP 工具的對話：Claude Code 執行工具前就把 tool_use 寫入紀錄檔，
 * 所以同一個工作目錄的紀錄檔中，檔尾有「尚未回覆的 mcp__*__<工具名>」的就是呼叫端。
 * 多個對話同時呼叫時取呼叫時間最新的；找不到回傳 null。
 */
export function findCallingSession(cwd: string, toolName: string, now = Date.now()): string | null {
  // Windows 的磁碟代號大小寫可能不同（c: 與 C:），資料夾名稱不分大小寫比對
  const want = encodeProjectDir(cwd).toLowerCase();
  const root = projectsDir();
  const name = existsSync(root) ? readdirSync(root).find((d) => d.toLowerCase() === want) : undefined;
  if (!name) return null;
  const dir = join(root, name);
  let best: { id: string; ts: number } | null = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const path = join(dir, f);
    try {
      if (now - statSync(path).mtimeMs > RECENT_MS) continue;
      for (const c of pendingToolUses(readTail(path, TAIL_BYTES))) {
        if (!c.name.startsWith('mcp__') || !c.name.endsWith(`__${toolName}`) || now - c.ts > RECENT_MS) continue;
        if (!best || c.ts > best.ts) best = { id: f.slice(0, -'.jsonl'.length), ts: c.ts };
      }
    } catch {
      // 檔案剛好被移動或無法讀取：略過
    }
  }
  return best?.id ?? null;
}

/**
 * 決定 MCP 呼叫屬於哪個 session：
 * 1. 參數帶了 session_id 就用它；
 * 2. 從紀錄檔找出正在呼叫這個工具的對話（不需要 Claude 帶 session_id）；
 * 3. 退而求其次：與呼叫端工作目錄相同、最近 10 分鐘內有活動的唯一 session。
 */
export function resolveSessionId(paths: StoragePaths, sessionId: string | undefined, cwd: string, now = Date.now(), toolName?: string): string {
  if (sessionId) return sessionId;
  if (toolName) {
    const calling = findCallingSession(cwd, toolName, now);
    if (calling) return calling;
  }
  const target = normalizePath(cwd).toLowerCase();
  const candidates = Object.entries(readState(paths).sessions).filter(
    ([, s]) => s.cwd && normalizePath(s.cwd).toLowerCase() === target && now - (s.last_activity_ts ?? 0) <= RECENT_MS,
  );
  if (candidates.length === 1) return candidates[0]![0];
  throw new SessionResolveError(
    candidates.length === 0
      ? '找不到這個對話的紀錄：請帶上 session_id 重試（可在對話開頭的 [Worktrail] 訊息中找到）'
      : `工作目錄 ${cwd} 有 ${candidates.length} 個進行中的對話，無法判斷是哪一個：請帶上 session_id 重試（可在對話開頭的 [Worktrail] 訊息中找到）`,
  );
}
