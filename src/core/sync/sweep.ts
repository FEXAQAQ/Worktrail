/**
 * 規格 5.3：補漏掃描。找出 hook 漏掉的 session，以及待補摘要的任務。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, localDate } from '../capture/tz.js';
import type { Config } from '../schema/config.js';
import type { StoragePaths } from '../storage/paths.js';
import { listTasks, type TaskRecord } from '../storage/tasks.js';
import { captureSession } from './capture-session.js';
import { encodeProjectDir, findTranscriptPath, projectsDir } from './locate.js';

export interface SweepResult {
  scanned: number;
  captured: number;
  created: string[];
  errors: string[];
  pending: TaskRecord[];
}

export function recentTranscripts(paths: StoragePaths, days: number, now = Date.now()): string[] {
  const root = projectsDir();
  if (!existsSync(root)) return [];
  const cutoff = now - days * 86_400_000;
  const skip = encodeProjectDir(paths.claudeRuns).toLowerCase();
  const out: { p: string; m: number }[] = [];
  for (const d of readdirSync(root)) {
    if (d.toLowerCase().startsWith(skip)) continue;
    const dir = join(root, d);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const p = join(dir, f);
      try {
        const m = statSync(p).mtimeMs;
        if (m >= cutoff) out.push({ p, m });
      } catch {
        // 忽略
      }
    }
  }
  // 依修改時間由舊到新，讓原對話先於分叉對話擷取（commit 認領的先後）
  return out.sort((a, b) => a.m - b.m).map((x) => x.p);
}

export async function sweep(args: {
  paths: StoragePaths;
  config: Config;
  now?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<SweepResult> {
  const { paths, config } = args;
  const now = args.now ?? Date.now();
  const files = recentTranscripts(paths, config.capture.sweep_days, now);
  const result: SweepResult = { scanned: files.length, captured: 0, created: [], errors: [], pending: [] };
  for (const [i, f] of files.entries()) {
    if (args.signal?.aborted) break;
    try {
      const r = await captureSession({ paths, config, transcriptPath: f });
      if (!r.skipped) {
        result.captured++;
        result.created.push(...r.tasks.map((t) => t.id));
      }
    } catch (e) {
      result.errors.push(`${f}: ${(e as Error).message}`);
    }
    args.onProgress?.(i + 1, files.length);
  }
  result.pending = pendingSummaries(paths, config, now);
  return result;
}

export function pendingSummaries(paths: StoragePaths, config: Config, now = Date.now(), days = config.capture.sweep_days): TaskRecord[] {
  const today = localDate(now, config.time.timezone);
  return listTasks(paths, addDays(today, -days), today).filter(
    (t) => !t.manual && (t.summary_status === 'draft' || t.summary_status === 'stale'),
  );
}

/** 強制重新擷取指定的 session（例如新增 Jira 專案代碼後，讓既有任務辨識出單號）；回傳實際擷取的數量 */
export async function recaptureSessions(paths: StoragePaths, config: Config, sessionIds: Iterable<string>, signal?: AbortSignal): Promise<number> {
  let n = 0;
  for (const id of new Set(sessionIds)) {
    if (signal?.aborted) break;
    const transcriptPath = findTranscriptPath(paths, id);
    if (!transcriptPath) continue;
    const r = await captureSession({ paths, config, transcriptPath, sessionId: id, force: true });
    if (!r.skipped) n++;
  }
  return n;
}
