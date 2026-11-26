/**
 * 規格 5.1：SessionStart／Stop／SessionEnd hook。
 *
 * 原則：絕不干擾開發。任何錯誤或逾時都以 exit 0 結束；只有摘要把關會 exit 2。
 */
import { localDate } from '../core/capture/tz.js';
import { loadConfig } from '../core/storage/config-store.js';
import { writeLog } from '../core/storage/log.js';
import { StoragePaths, storageRoot } from '../core/storage/paths.js';
import { readState, sessionState, updateState } from '../core/storage/state.js';
import { captureSession } from '../core/sync/capture-session.js';
import { evaluateGuard, GUARD_MESSAGE, measureProgress } from '../core/sync/guard.js';

export type HookEvent = 'session-start' | 'stop' | 'session-end';

export interface HookOutput {
  code: 0 | 2;
  stdout?: string;
  stderr?: string;
}

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  stop_hook_active?: boolean;
  source?: string;
}

export const HOOK_TIMEOUT_MS = 2000;

export async function runHook(
  event: HookEvent,
  stdin: string,
  env: NodeJS.ProcessEnv = process.env,
  /** 時間上限；正式執行固定 2 秒，測試在忙碌的機器上可放寬，避免把逾時誤判為功能錯誤 */
  timeoutMs = HOOK_TIMEOUT_MS,
): Promise<HookOutput> {
  if (env.WORKTRAIL_INTERNAL === '1') return { code: 0 };
  const root = storageRoot();
  if (!root) return { code: 0 };
  const paths = new StoragePaths(root);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<HookOutput>((resolve) => {
    timer = setTimeout(() => {
      writeLog(paths, `hook:${event}`, 'warn', `逾時（${timeoutMs} ms），本次放棄`);
      resolve({ code: 0 });
    }, timeoutMs);
  });
  try {
    return await Promise.race([handle(event, stdin, paths), timeout]);
  } catch (e) {
    writeLog(paths, `hook:${event}`, 'error', e instanceof Error ? (e.stack ?? e.message) : String(e));
    return { code: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function handle(event: HookEvent, stdin: string, paths: StoragePaths): Promise<HookOutput> {
  const payload = JSON.parse(stdin || '{}') as HookPayload;
  const sessionId = payload.session_id;
  if (!sessionId) return { code: 0 };
  const { config } = loadConfig(paths);

  if (event === 'session-start') {
    await updateState(paths, (s) => {
      const ss = sessionState(s, sessionId);
      ss.cwd = payload.cwd ?? ss.cwd;
      ss.transcript_path = payload.transcript_path ?? ss.transcript_path;
      ss.last_activity_ts = Date.now();
    });
    // 注入 session_id，讓 Claude 呼叫 MCP 時能帶上
    return {
      code: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `[Worktrail] session_id=${sessionId}` },
      }),
    };
  }

  if (!payload.transcript_path) return { code: 0 };
  const result = await captureSession({
    paths,
    config,
    transcriptPath: payload.transcript_path,
    sessionId,
    cwd: payload.cwd,
  });
  if (event !== 'stop' || result.skipped || !result.draft || !result.ownEvents) return { code: 0 };

  // 摘要把關（只針對今天的工作）
  const today = localDate(Date.now(), config.time.timezone);
  if (!result.draft.days.some((d) => d.date === today)) return { code: 0 };
  const latestSha = result.draft.days.flatMap((d) => d.commits).at(-1)?.sha;
  const ss = readState(paths).sessions[result.sessionId];
  const guard = evaluateGuard({
    config,
    stopHookActive: payload.stop_hook_active === true,
    current: measureProgress(result.ownEvents, latestSha),
    atSummary: ss?.summary_progress ?? null,
    guarded: ss?.guarded ?? [],
  });
  if (!guard.block) return { code: 0 };

  await updateState(paths, (s) => {
    const st = sessionState(s, result.sessionId);
    st.guarded = [...(st.guarded ?? []), guard.fingerprint].slice(-50);
  });
  writeLog(paths, 'hook:stop', 'info', `把關：${result.sessionId} ${guard.fingerprint}`);
  return { code: 2, stderr: GUARD_MESSAGE };
}
