/**
 * 呼叫 `claude -p`（規格 5.3、9.6）。以 WORKTRAIL_INTERNAL=1 執行，避免 hook 記錄自己。
 * 工作目錄固定在 `<storage>/.worktrail/claude-runs`，補漏掃描會排除。
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ensureDir } from '../storage/fsutil.js';

export function findClaude(configured: string): Promise<string | null> {
  if (configured) return Promise.resolve(existsSync(configured) ? configured : null);
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(cmd, ['claude'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // Windows 優先選 .exe，其次 .cmd
      const pick = lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => /\.cmd$/i.test(l)) ?? lines[0];
      resolve(pick ?? null);
    });
  });
}

/** 解析 `claude auth status --json`：回傳 loggedIn；格式不符時為 null */
export function parseAuthStatus(out: string): boolean | null {
  try {
    const j = JSON.parse(out) as { loggedIn?: unknown };
    return typeof j.loggedIn === 'boolean' ? j.loggedIn : null;
  } catch {
    return null;
  }
}

const loginCache = new Map<string, { at: number; value: boolean | null }>();
const LOGIN_CACHE_MS = 5 * 60_000;

/**
 * 是否已登入 Claude 帳號（`claude auth status`）。舊版 Claude Code 沒有這個指令或執行失敗時回傳 null（無法判斷）。
 * 結果快取 5 分鐘：設定頁的健康檢查會定期呼叫，不必每次都啟動 claude。
 */
export async function claudeLoginStatus(claudePath: string, opts: { fresh?: boolean } = {}): Promise<boolean | null> {
  const hit = loginCache.get(claudePath);
  if (!opts.fresh && hit && Date.now() - hit.at < LOGIN_CACHE_MS) return hit.value;
  const args = ['auth', 'status', '--json'];
  const value = await new Promise<boolean | null>((resolve) => {
    const done = (err: Error | null, stdout: string) => resolve(err && !stdout ? null : parseAuthStatus(stdout));
    const o = { windowsHide: true, timeout: 15_000, encoding: 'utf8' as const, env: { ...process.env, WORKTRAIL_INTERNAL: '1' } };
    if (/\.(cmd|bat)$/i.test(claudePath)) execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', shellCommand(claudePath, args)], { ...o, windowsVerbatimArguments: true }, (e, out) => done(e, out));
    else execFile(claudePath, args, o, (e, out) => done(e, out));
  });
  loginCache.set(claudePath, { at: Date.now(), value });
  return value;
}

export interface ClaudeRunOptions {
  claudePath: string;
  prompt: string;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (chars: number) => void;
  /** 額外的 CLI 參數，例如 ['--allowedTools', ...] */
  extraArgs?: string[];
}

export class ClaudeCliError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(message);
  }
}

/** 組成 cmd.exe 的指令字串，含空白或特殊字元的參數加上引號 */
export function shellCommand(cmd: string, args: string[]): string {
  const quote = (a: string) => (/^[\w\-./:\\@=]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
  return [`"${cmd}"`, ...args.map(quote)].join(' ');
}

/** 以 stdin 傳入 prompt，回傳文字輸出 */
export function runClaudePrint(opts: ClaudeRunOptions): Promise<string> {
  ensureDir(opts.cwd);
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', ...(opts.extraArgs ?? [])];
    const spawnOpts = { cwd: opts.cwd, env: { ...process.env, WORKTRAIL_INTERNAL: '1' }, windowsHide: true };
    // .cmd 必須經由 cmd.exe 執行；以完整指令字串呼叫（Node 已棄用 shell 模式搭配參數陣列）
    const child = /\.(cmd|bat)$/i.test(opts.claudePath)
      ? spawn(shellCommand(opts.claudePath, args), { ...spawnOpts, shell: true })
      : spawn(opts.claudePath, args, spawnOpts);
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new ClaudeCliError('claude -p 執行逾時'));
    }, opts.timeoutMs ?? 10 * 60_000);
    const onAbort = () => {
      child.kill();
      reject(new ClaudeCliError('已取消'));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
      opts.onProgress?.(out.length);
    });
    child.stderr.on('data', (d: string) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new ClaudeCliError(`無法執行 claude：${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return;
      if (code === 0) resolve(out.trim());
      else reject(new ClaudeCliError(`claude -p 結束碼 ${code}`, err.slice(-2000)));
    });
    child.stdin.end(opts.prompt, 'utf8');
  });
}

/** 從模型輸出中取出第一個 JSON 物件（容忍前後文字與程式碼框） */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  if (start < 0) throw new Error('輸出中找不到 JSON');
  let depth = 0;
  let inStr = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(candidate.slice(start, i + 1));
  }
  throw new Error('JSON 不完整');
}
