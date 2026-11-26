/**
 * `.worktrail/logs/`：hook 與 daemon 的執行紀錄，保留 14 天（規格 15）。
 * 寫 log 本身絕不丟例外。
 */
import { appendFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir } from './fsutil.js';
import type { StoragePaths } from './paths.js';

const RETAIN_DAYS = 14;

export type LogLevel = 'info' | 'warn' | 'error';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function writeLog(paths: StoragePaths, component: string, level: LogLevel, message: string): void {
  try {
    ensureDir(paths.logs);
    const line = `${new Date().toISOString()} [${level}] ${component}: ${message.replace(/\r?\n/g, ' ⏎ ')}\n`;
    appendFileSync(join(paths.logs, `${today()}.log`), line, 'utf8');
  } catch {
    // 忽略
  }
}

export function pruneLogs(paths: StoragePaths): void {
  try {
    const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
    for (const f of readdirSync(paths.logs)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && Date.parse(m[1]!) < cutoff) rmSync(join(paths.logs, f), { force: true });
    }
  } catch {
    // 忽略
  }
}

/** 最近的錯誤（doctor、UI 用） */
export function recentErrors(paths: StoragePaths, limit = 20): string[] {
  try {
    const files = readdirSync(paths.logs).filter((f) => f.endsWith('.log')).sort().slice(-3);
    const lines = files.flatMap((f) => readFileSync(join(paths.logs, f), 'utf8').split('\n'));
    return lines.filter((l) => l.includes('[error]') || l.includes('[warn]')).slice(-limit);
  } catch {
    return [];
  }
}
