/**
 * hook 進入點（打包成 dist/hook.cjs，減少啟動時間）。
 * 用法：node hook.cjs <session-start|stop|session-end>，stdin 為 Claude Code 的 hook JSON。
 */
import { runHook, type HookEvent } from './run.js';

const EVENTS: HookEvent[] = ['session-start', 'stop', 'session-end'];

export async function hookMain(arg: string | undefined): Promise<never> {
  const event = EVENTS.find((e) => e === arg);
  if (!event) process.exit(0);
  let input = '';
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk as string;
  } catch {
    process.exit(0);
  }
  const out = await runHook(event, input).catch(() => ({ code: 0 as const, stdout: undefined, stderr: undefined }));
  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  process.exit(out.code);
}

// 直接執行時（dist/hook.cjs）
const entry = process.argv[1] ?? '';
if (/hook\.(c?js|ts)$/.test(entry)) void hookMain(process.argv[2]);
