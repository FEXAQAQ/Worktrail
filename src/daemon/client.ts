/**
 * 常駐服務的用戶端：查詢狀態、背景啟動、停止。
 * `~/.worktrail/daemon.json` 記錄 pid、port、token（規格 11.6、12.1）。
 */
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { cliEntry } from '../core/program.js';
import { removeFile } from '../core/storage/fsutil.js';
import { daemonInfoPath } from '../core/storage/paths.js';

export interface DaemonInfo {
  pid: number;
  port: number;
  token: string;
  started_at: string;
  version: string;
  /** 服務啟動時 cli.cjs 的修改時間：重新建置（更新）後與目前檔案不同，代表服務還在跑舊程式 */
  build?: number;
}

/** 目前建置的識別：cli.cjs 的修改時間（找不到時為 0） */
export function currentBuild(cli = cliEntry()): number {
  try {
    return Math.round(statSync(cli).mtimeMs);
  } catch {
    return 0;
  }
}

/** 執行中的服務是否為舊版程式（更新後尚未重啟）。舊版服務沒有記錄 build，一律視為過期 */
export function isOutdated(info: DaemonInfo, cli = cliEntry()): boolean {
  const now = currentBuild(cli);
  return now !== 0 && info.build !== now;
}

/** 服務在執行且是舊版時重新啟動；回傳是否有重啟 */
export async function restartIfOutdated(nodePath = process.execPath, cli = cliEntry()): Promise<boolean> {
  const info = readDaemonInfo();
  if (!info || !isOutdated(info, cli) || !(await isDaemonRunning(info))) return false;
  await stopDaemon();
  await startDaemonDetached(nodePath);
  return true;
}

export function readDaemonInfo(): DaemonInfo | null {
  try {
    const d = JSON.parse(readFileSync(daemonInfoPath(), 'utf8')) as DaemonInfo;
    return typeof d.port === 'number' && typeof d.token === 'string' ? d : null;
  } catch {
    return null;
  }
}

export const uiUrl = (port: number) => `http://localhost:${port}`;

export function apiCall<T = unknown>(
  info: Pick<DaemonInfo, 'port' | 'token'>,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 2000,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: info.port,
        method,
        path,
        timeout: timeoutMs,
        headers: {
          host: `localhost:${info.port}`,
          authorization: `Bearer ${info.token}`,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (text += d));
        res.on('end', () => {
          let data: unknown = text;
          try {
            data = JSON.parse(text);
          } catch {
            // 非 JSON
          }
          resolve({ status: res.statusCode ?? 0, data: data as T });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export async function isDaemonRunning(info = readDaemonInfo()): Promise<boolean> {
  if (!info) return false;
  try {
    const r = await apiCall(info, 'GET', '/api/ping', undefined, 1000);
    return r.status === 200;
  } catch {
    return false;
  }
}

/** 背景啟動（不顯示終端機視窗），等待就緒最多 timeoutMs */
export async function startDaemonDetached(nodePath = process.execPath, timeoutMs = 10_000): Promise<DaemonInfo | null> {
  if (await isDaemonRunning()) return readDaemonInfo();
  const child = spawn(nodePath, [cliEntry(), 'start', '--foreground'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, WORKTRAIL_INTERNAL: undefined },
  });
  child.unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const info = readDaemonInfo();
    if (info && info.pid === child.pid && (await isDaemonRunning(info))) return info;
    if (info && (await isDaemonRunning(info))) return info;
  }
  return null;
}

export async function stopDaemon(): Promise<boolean> {
  const info = readDaemonInfo();
  if (!info) return false;
  try {
    await apiCall(info, 'POST', '/api/shutdown', {}, 2000);
  } catch {
    try {
      process.kill(info.pid);
    } catch {
      // 已結束
    }
  }
  for (let i = 0; i < 25; i++) {
    if (!(await isDaemonRunning(info))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  removeFile(daemonInfoPath());
  return true;
}
