/**
 * 前景執行常駐服務（`worktrail start --foreground`；背景啟動時由 client 以分離程序呼叫）。
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { cliEntry, uiDir, VERSION } from '../core/program.js';
import { loadConfig } from '../core/storage/config-store.js';
import { removeFile, writeFileAtomic } from '../core/storage/fsutil.js';
import { pruneLogs, writeLog } from '../core/storage/log.js';
import { daemonInfoPath, StoragePaths, storageRoot } from '../core/storage/paths.js';
import { currentBuild, isDaemonRunning, readDaemonInfo, uiUrl, type DaemonInfo } from './client.js';
import { createDaemon } from './server.js';
import { openAppWindow } from '../launcher/open.js';

export async function runDaemonForeground(): Promise<void> {
  const root = storageRoot();
  if (!root) throw new Error('Worktrail 尚未安裝：請先執行 worktrail install');
  if (await isDaemonRunning()) {
    console.log(`常駐服務已在執行：${uiUrl(readDaemonInfo()!.port)}`);
    return;
  }
  const paths = new StoragePaths(root);
  const { config } = loadConfig(paths);
  const token = randomBytes(24).toString('hex');
  const port = config.ui.port;

  let daemon: ReturnType<typeof createDaemon>;
  const shutdown = async (restart = false) => {
    writeLog(paths, 'daemon', 'info', restart ? '重新啟動' : '停止');
    await daemon.stop().catch(() => undefined);
    if (readDaemonInfo()?.pid === process.pid) removeFile(daemonInfoPath());
    if (restart) {
      spawn(process.execPath, [cliEntry(), 'start', '--foreground'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
    process.exit(0);
  };

  daemon = createDaemon({
    paths,
    port,
    token,
    uiDir: uiDir(),
    onShutdown: () => void shutdown(false),
    onRestart: () => void shutdown(true),
  });
  try {
    await daemon.start();
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `埠號 ${port} 已被使用，請在 config.yaml 修改 ui.port` : (e as Error).message;
    writeLog(paths, 'daemon', 'error', msg);
    throw new Error(msg);
  }

  const info: DaemonInfo = { pid: process.pid, port, token, started_at: new Date().toISOString(), version: VERSION, build: currentBuild() };
  writeFileAtomic(daemonInfoPath(), JSON.stringify(info, null, 2));
  try {
    chmodSync(daemonInfoPath(), 0o600);
  } catch {
    // Windows 不支援
  }
  pruneLogs(paths);
  writeLog(paths, 'daemon', 'info', `啟動：${uiUrl(port)}（pid ${process.pid}）`);
  console.log(`Worktrail 服務已啟動：${uiUrl(port)}`);
  if (config.ui.open_browser_on_start) void openAppWindow(uiUrl(port));

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
