/**
 * 擷取一個 session 並寫入任務檔。Stop／SessionEnd hook、MCP、補漏掃描共用。
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { analyzeSession, type SessionDraft } from '../capture/analyze.js';
import { committedShas } from '../capture/commits.js';
import { getCommits, readHeadSha } from '../capture/git.js';
import { matchPath, normalizePath } from '../capture/project.js';
import type { Config } from '../schema/config.js';
import { withLock } from '../storage/fsutil.js';
import type { StoragePaths } from '../storage/paths.js';
import { sessionState, updateState, readState } from '../storage/state.js';
import { findTaskFile, readTask, taskLockKey, writeTask, type TaskRecord } from '../storage/tasks.js';
import { parseTranscript, type ParsedTranscript, type TranscriptEvent } from '../transcript/index.js';
import { readTicketCache } from '../ticket-info/index.js';
import { mergeCapture } from './merge.js';

export interface CaptureOptions {
  paths: StoragePaths;
  config: Config;
  transcriptPath: string;
  sessionId?: string;
  cwd?: string;
  /** 是否讀取 git commit（預設 true） */
  git?: boolean;
  /** 紀錄檔未變動也重新擷取 */
  force?: boolean;
  /** 即使活躍時間低於門檻也建立此日期的任務（MCP 寫入摘要時） */
  ensureDate?: string;
}

export interface CaptureResult {
  sessionId: string;
  skipped?: 'unchanged' | 'excluded' | 'internal' | 'unreadable';
  draft?: SessionDraft;
  parsed?: ParsedTranscript;
  ownEvents?: TranscriptEvent[];
  tasks: TaskRecord[];
}

export function isExcluded(cwd: string | undefined, config: Config, paths: StoragePaths): boolean {
  if (!cwd) return false;
  if (normalizePath(cwd).toLowerCase().startsWith(normalizePath(paths.internal).toLowerCase())) return true;
  return config.capture.exclude_paths.some((g) => matchPath(cwd, g));
}

export async function captureSession(opts: CaptureOptions): Promise<CaptureResult> {
  const { paths, config } = opts;
  const fallbackId = opts.sessionId ?? basename(opts.transcriptPath, '.jsonl');

  let size: number;
  let mtime: number;
  try {
    const st = statSync(opts.transcriptPath);
    size = st.size;
    mtime = st.mtimeMs;
  } catch {
    return { sessionId: fallbackId, skipped: 'unreadable', tasks: [] };
  }

  const prev = readState(paths).sessions[fallbackId];
  if (!opts.force && prev && prev.transcript_size === size && prev.transcript_mtime === mtime) {
    return { sessionId: fallbackId, skipped: 'unchanged', tasks: [] };
  }

  const parsed = parseTranscript(readFileSync(opts.transcriptPath, 'utf8'));
  const sessionId = parsed.meta.sessionId ?? fallbackId;
  const cwd = parsed.meta.cwd ?? opts.cwd;
  if (isExcluded(cwd, config, paths)) return { sessionId, skipped: 'excluded', tasks: [] };

  const own = parsed.events.filter((e) => !e.copied);
  const evidence = committedShas(own);

  // 同一 repo 其他 session 認領的 commit
  const state = readState(paths);
  const claimedElsewhere = Object.entries(state.sessions)
    .filter(([id, s]) => id !== sessionId && s.cwd && cwd && normalizePath(s.cwd) === normalizePath(cwd))
    .flatMap(([, s]) => s.claimed_commits ?? []);

  let commits: Awaited<ReturnType<typeof getCommits>> = [];
  let gitCache = state.sessions[sessionId]?.git_cache;
  if (opts.git !== false && cwd && own.length) {
    const since = own[0]!.ts;
    const until = own.at(-1)!.ts + 60 * 60_000;
    const head = readHeadSha(cwd);
    // 不是 git 專案（或資料夾已不存在）：不啟動 git，Windows 上每次 spawn 都要數百毫秒
    if (!head) {
      gitCache = undefined;
    } else if (gitCache && gitCache.head === head && gitCache.since <= since && gitCache.until >= until - 60 * 60_000) {
      commits = gitCache.commits.filter((c) => c.ts >= since && c.ts <= until);
    } else {
      commits = await getCommits({ cwd, since, until });
      gitCache = { head, since, until, commits };
    }
  }

  const draft = analyzeSession({ parsed, config, commits, claimedElsewhere, sessionIdFallback: sessionId, ticketCache: readTicketCache(paths) });

  const tasks: TaskRecord[] = [];
  const days = [...draft.days];
  if (opts.ensureDate && !days.some((d) => d.date === opts.ensureDate)) {
    days.push({
      date: opts.ensureDate,
      active_minutes: 0,
      hours: 0,
      first_activity: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      commits: [],
    });
  }
  for (const day of days) {
    const record = await withLock(taskLockKey(paths, day.date, sessionId), () => {
      const existingPath = findTaskFile(paths, day.date, sessionId);
      const existing = existingPath ? readTask(existingPath) : null;
      const merged = mergeCapture({ existing, draft, day, config, force: day.date === opts.ensureDate });
      if (!merged) return null;
      return writeTask(paths, merged, existingPath ?? undefined);
    });
    if (record) tasks.push(record);
  }

  await updateState(paths, (s) => {
    const ss = sessionState(s, sessionId);
    ss.transcript_path = opts.transcriptPath;
    ss.cwd = cwd;
    ss.transcript_size = size;
    ss.transcript_mtime = mtime;
    ss.claimed_commits = evidence;
    ss.last_capture_at = new Date().toISOString();
    ss.last_activity_ts = own.at(-1)?.ts ?? ss.last_activity_ts;
    ss.dates = [...new Set([...(ss.dates ?? []), ...tasks.map((t) => t.date)])].sort();
    ss.git_cache = gitCache;
  });

  return { sessionId, draft, parsed, ownEvents: own, tasks };
}
