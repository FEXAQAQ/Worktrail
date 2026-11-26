/**
 * `.worktrail/state.json`：各 session 的擷取進度與把關狀態（規格 4.1、5.1、5.2）。
 */
import { readText, withLock, writeFileAtomic } from './fsutil.js';
import type { StoragePaths } from './paths.js';

export interface SessionState {
  transcript_path?: string;
  cwd?: string;
  /** SessionStart 時間或首次擷取時間（ISO） */
  registered_at: string;
  /** 最近一次擷取時間（ISO） */
  last_capture_at?: string;
  /** 對話最後一個事件的時間（epoch 毫秒），用於 MCP 的 session 對應 */
  last_activity_ts?: number;
  /** 上次擷取時紀錄檔的大小與修改時間；未變動時跳過 */
  transcript_size?: number;
  transcript_mtime?: number;
  /** 本 session 以 git commit 輸出認領的 commit */
  claimed_commits?: string[];
  /** 已把關過的進展指紋（規格 5.2 第 4 點） */
  guarded?: string[];
  /** 最近一次寫入摘要時的進展（最新 commit 與編輯次數），把關以此為基準 */
  summary_progress?: { sha: string; edits: number };
  /** 本 session 擷取到的任務日期 */
  dates?: string[];
  /** git 快取：HEAD 未變動時沿用，不再啟動 git 子程序 */
  git_cache?: { head: string; since: number; until: number; commits: { sha: string; message: string; ts: number }[] };
}

export interface State {
  schema: 1;
  sessions: Record<string, SessionState>;
}

const emptyState = (): State => ({ schema: 1, sessions: {} });

export function readState(paths: StoragePaths): State {
  const text = readText(paths.state);
  if (!text) return emptyState();
  try {
    const s = JSON.parse(text) as Partial<State>;
    return { schema: 1, sessions: s.sessions && typeof s.sessions === 'object' ? s.sessions : {} };
  } catch {
    return emptyState();
  }
}

const RETAIN_MS = 90 * 24 * 3600_000;

/** 在鎖內讀取、修改、寫回；同時清除 90 天未活動的 session */
export async function updateState<T>(paths: StoragePaths, fn: (s: State) => T): Promise<T> {
  return withLock(paths.state, () => {
    const s = readState(paths);
    const result = fn(s);
    const cutoff = Date.now() - RETAIN_MS;
    for (const [id, ss] of Object.entries(s.sessions)) {
      const last = ss.last_activity_ts ?? Date.parse(ss.last_capture_at ?? ss.registered_at);
      if (!Number.isNaN(last) && last < cutoff) delete s.sessions[id];
    }
    writeFileAtomic(paths.state, JSON.stringify(s, null, 2));
    return result;
  });
}

export function sessionState(s: State, sessionId: string): SessionState {
  return (s.sessions[sessionId] ??= { registered_at: new Date().toISOString() });
}
