/**
 * 規格 5.2：摘要把關（純函式）。
 */
import type { Config } from '../schema/config.js';
import type { TranscriptEvent } from '../transcript/index.js';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export const GUARD_MESSAGE =
  '[Worktrail] 本任務有新進展但日誌尚未更新，請先呼叫 worklog_save_summary 更新子項與狀態後再結束。';

export interface Progress {
  /** 本 session 最新的 commit sha（沒有則為空字串） */
  sha: string;
  /** 本 session 檔案編輯類工具的累計次數 */
  edits: number;
}

export function measureProgress(ownEvents: readonly TranscriptEvent[], latestSha: string | undefined): Progress {
  let edits = 0;
  for (const e of ownEvents) if (e.role === 'tool_use' && !e.sidechain && e.toolName && EDIT_TOOLS.has(e.toolName)) edits++;
  return { sha: latestSha ?? '', edits };
}

export const fingerprint = (p: Progress) => `${p.sha}:${p.edits}`;

export interface GuardInput {
  config: Config;
  stopHookActive: boolean;
  current: Progress;
  /** 上次寫入摘要時的進展；從未摘要則為 null */
  atSummary: Progress | null;
  /** 已把關過的指紋 */
  guarded: readonly string[];
}

export interface GuardResult {
  block: boolean;
  fingerprint: string;
  reason?: string;
}

export function evaluateGuard(input: GuardInput): GuardResult {
  const fp = fingerprint(input.current);
  const no = (reason: string): GuardResult => ({ block: false, fingerprint: fp, reason });
  if (input.stopHookActive) return no('stop_hook_active');
  const mode = input.config.capture.guard;
  if (mode === 'off') return no('guard off');
  if (input.guarded.includes(fp)) return no('already guarded');

  const base = input.atSummary ?? { sha: '', edits: 0 };
  if (mode === 'commit') {
    if (!input.current.sha || input.current.sha === base.sha) return no('no new commit');
  } else if (input.current.edits - base.edits < input.config.capture.guard_edit_threshold) {
    return no('edits below threshold');
  }
  return { block: true, fingerprint: fp };
}
