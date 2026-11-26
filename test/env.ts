/** 測試環境：把 WORKTRAIL_HOME、CLAUDE_CONFIG_DIR 指到暫存資料夾，絕不碰使用者真實的設定。 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStorage } from '../src/core/storage/init.js';
import { StoragePaths } from '../src/core/storage/paths.js';
import { writeFileAtomic } from '../src/core/storage/fsutil.js';

export interface TestEnv {
  dir: string;
  home: string;
  claude: string;
  storage: string;
  paths: StoragePaths;
  cleanup: () => void;
}

export function makeEnv(opts: { install?: boolean } = {}): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'worktrail-test-'));
  const home = join(dir, 'worktrail-home');
  const claude = join(dir, 'claude');
  const storage = join(dir, 'storage');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(claude, 'projects'), { recursive: true });
  const prev = { WORKTRAIL_HOME: process.env.WORKTRAIL_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.WORKTRAIL_HOME = home;
  process.env.CLAUDE_CONFIG_DIR = claude;
  const paths = new StoragePaths(storage);
  if (opts.install !== false) {
    writeFileAtomic(join(home, 'pointer.json'), JSON.stringify({ storage_root: storage }));
    initStorage(paths);
  }
  return {
    dir,
    home,
    claude,
    storage,
    paths,
    cleanup: () => {
      process.env.WORKTRAIL_HOME = prev.WORKTRAIL_HOME;
      process.env.CLAUDE_CONFIG_DIR = prev.CLAUDE_CONFIG_DIR;
      if (prev.WORKTRAIL_HOME === undefined) delete process.env.WORKTRAIL_HOME;
      if (prev.CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** 建立一個有 commit 的 git repo，回傳 commit 的短 sha */
export function makeRepo(dir: string, message = 'feat: TDDA-1869 發送演練 API', date?: string): string {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date ?? '', GIT_COMMITTER_DATE: date ?? '' },
    }).trim();
  git('init', '-q');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'user.name', 'Dev');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'a.txt'), String(Math.random()));
  git('add', '.');
  git('commit', '-q', '-m', message);
  return git('rev-parse', '--short', 'HEAD');
}

/** 寫入 Claude Code 專案資料夾下的紀錄檔 */
export function writeTranscript(env: TestEnv, cwd: string, sessionId: string, lines: string[]): string {
  const dir = join(env.claude, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${sessionId}.jsonl`);
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}
