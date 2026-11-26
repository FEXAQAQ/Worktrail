/**
 * 規格 14.3：原子寫入與檔案鎖。hook、MCP、daemon 可能同時寫同一個檔案。
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 先寫暫存檔再 rename。Windows 上目標檔被其他程序開啟時 rename 可能暫時失敗，重試數次。 */
export function writeFileAtomic(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt < 10 && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
        sleepSync(20 * (attempt + 1));
        continue;
      }
      rmSync(tmp, { force: true });
      throw e;
    }
  }
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** 檔案內容雜湊，作為衝突偵測用的 version（規格 12.3） */
export function contentVersion(content: string): string {
  return createHash('sha1').update(content).digest('hex').slice(0, 12);
}

export function shortHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 6);
}

/**
 * 取得檔案鎖後執行 fn。目標檔不存在也可上鎖（鎖的是 `<path>.lock` 目錄）。
 * stale 10 秒：持鎖程序當掉時，其他程序 10 秒後可接手。
 */
export async function withLock<T>(path: string, fn: () => T | Promise<T>): Promise<T> {
  ensureDir(dirname(path));
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 10_000,
    retries: { retries: 50, minTimeout: 10, maxTimeout: 100, factor: 1.5 },
  });
  try {
    return await fn();
  } finally {
    await release().catch(() => undefined);
  }
}

export function removeFile(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}
