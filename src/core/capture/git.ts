/**
 * 規格 5.1 Stop 第 4 步：取得 first_activity 之後、作者為本人的 commit。
 * 只呼叫本機 git；任何失敗都回傳空陣列，不丟例外。
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * 不啟動 git 子程序，直接讀檔取得 HEAD 的 commit sha（Windows 上 spawn git 每次約 200 ms）。
 * 支援一般 repo、worktree（.git 為檔案）與 packed-refs。找不到時回傳 null。
 */
/** 由工作目錄往上找 .git（資料夾，或 worktree 的 .git 檔案指向的資料夾） */
function findGitDir(cwd: string): string | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 30; i++) {
    const g = join(dir, '.git');
    if (existsSync(g)) {
      if (statSync(g).isDirectory()) return g;
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(g, 'utf8'));
      return m ? (isAbsolute(m[1]!.trim()) ? m[1]!.trim() : resolve(dir, m[1]!.trim())) : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function readHeadSha(cwd: string): string | null {
  try {
    const gitDir = findGitDir(cwd);
    if (!gitDir) return null;
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return /^[0-9a-f]{40}$/.test(head) ? head : null;
    // worktree 的 refs 放在共用的 commondir
    const common = existsSync(join(gitDir, 'commondir')) ? resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim()) : gitDir;
    for (const base of [gitDir, common]) {
      const loose = join(base, ref);
      if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
    }
    const packed = join(common, 'packed-refs');
    if (existsSync(packed)) {
      const line = readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
      if (line) return line.split(' ')[0]!;
    }
    return null;
  } catch {
    return null;
  }
}

/** 解析 git config 檔：[user] 區段最後一個 email；檔案用了 include 時回傳 'include'（交給 git 判斷） */
export function parseConfigEmail(text: string): string | null | 'include' {
  let section = '';
  let email: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([^\]\s"]+)/.exec(line);
    if (sec) {
      section = sec[1]!.toLowerCase();
      if (section === 'include' || section === 'includeif') return 'include';
      continue;
    }
    const kv = /^email\s*=\s*(.*)$/i.exec(line);
    if (section === 'user' && kv) email = kv[1]!.replace(/\s+[#;].*$/, '').replace(/^"(.*)"$/, '$1').trim() || null;
  }
  return email;
}

/**
 * 不啟動 git 子程序讀出 user.email：repo 的 config 優先，其次全域設定。
 * 回傳 null 代表沒有設定；undefined 代表無法單靠讀檔判斷（例如用了 include），要問 git。
 */
export function readUserEmail(cwd: string): string | null | undefined {
  try {
    const gitDir = findGitDir(cwd);
    const home = process.env.HOME || homedir();
    const xdg = process.env.XDG_CONFIG_HOME || join(home, '.config');
    const files: string[] = [];
    if (gitDir) {
      files.push(join(gitDir, 'config'));
      const cd = join(gitDir, 'commondir');
      if (existsSync(cd)) files.push(join(resolve(gitDir, readFileSync(cd, 'utf8').trim()), 'config'));
    }
    files.push(join(home, '.gitconfig'), join(xdg, 'git', 'config'));
    for (const f of files) {
      if (!existsSync(f)) continue;
      const r = parseConfigEmail(readFileSync(f, 'utf8'));
      if (r === 'include') return undefined;
      if (r) return r;
    }
    return null;
  } catch {
    return undefined;
  }
}

export interface GitCommit {
  sha: string;
  message: string;
  /** 作者時間 epoch 毫秒 */
  ts: number;
}

function git(cwd: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

const FS = '\x1f';
const RS = '\x1e';

/** 解析 `%h FS %aI FS [%ae FS] %s RS` 格式；有四個欄位時第三個是作者 email */
export function parseGitLog(out: string): (GitCommit & { email?: string })[] {
  return out
    .split(RS)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const f = r.split(FS);
      const [sha = '', iso = ''] = f;
      return f.length >= 4 ? { sha, ts: Date.parse(iso), email: f[2], message: f.slice(3).join(FS) } : { sha, ts: Date.parse(iso), message: f[2] ?? '' };
    })
    .filter((c) => c.sha && !Number.isNaN(c.ts));
}

/**
 * 作者 email 優先直接讀 git config 檔；讀檔無法判斷時才和 git log 同時查詢
 * （Windows 上每次 spawn git 約數百毫秒，忙碌時可達數秒，依序執行會讓 hook 超過 2 秒上限）。
 * 以作者 email 在這裡過濾。
 */
export async function getCommits(args: {
  cwd: string;
  since: number;
  until?: number;
  timeoutMs?: number;
}): Promise<GitCommit[]> {
  const timeout = args.timeoutMs ?? 1500;
  const logArgs = [
    'log',
    'HEAD',
    '--no-merges',
    `--since=${new Date(args.since).toISOString()}`,
    `--format=%h${FS}%aI${FS}%ae${FS}%s${RS}`,
  ];
  if (args.until) logArgs.push(`--until=${new Date(args.until).toISOString()}`);
  const known = readUserEmail(args.cwd);
  const [emailOut, out] = await Promise.all([
    known === undefined ? git(args.cwd, ['config', 'user.email'], timeout) : Promise.resolve(known),
    git(args.cwd, logArgs, timeout),
  ]);
  if (!out) return [];
  const email = emailOut?.trim().toLowerCase();
  // git --since 以 commit date 判斷，這裡再以作者時間精確過濾
  return parseGitLog(out)
    .filter((c) => !email || c.email?.toLowerCase() === email)
    .filter((c) => c.ts >= args.since && (!args.until || c.ts <= args.until))
    .map(({ email: _email, ...c }) => c)
    .sort((a, b) => a.ts - b.ts);
}
