/**
 * 規格 11.6：一鍵啟動器（dist/launcher.cjs；Windows 另打包為 worktrail-launcher.exe）。
 *
 * 1. 檢查常駐服務是否執行中；2. 未執行則背景啟動（不顯示終端機視窗）；
 * 3. 立即以獨立視窗開啟啟動畫面（dist/ui/splash.html），服務就緒後自動切換到 UI；
 *    畫面在 10 秒內沒等到服務會顯示錯誤。沒有啟動畫面檔時，等待就緒後才開視窗，失敗則跳出錯誤與「執行診斷」。
 * 服務還在跑更新前的舊程式時（cli.cjs 重新建置過），先停止再以新程式啟動，使用者不必手動重啟。
 * `--background`：只啟動服務、不開視窗（開機自動啟動用）。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../core/storage/config-store.js';
import { StoragePaths, storageRoot } from '../core/storage/paths.js';
import { isDaemonRunning, isOutdated, readDaemonInfo, stopDaemon, uiUrl } from '../daemon/client.js';
import { openAppWindow, showError } from './open.js';

/** 啟動器所在資料夾的 cli.cjs；SEA 執行檔中 __filename 指向 exe 本身 */
function locateCli(): string {
  const candidates = [
    process.env.WORKTRAIL_CLI,
    join(dirname(process.execPath), 'cli.cjs'),
    join(dirname(process.argv[1] ?? ''), 'cli.cjs'),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1]!;
}

/** SEA 執行檔內沒有獨立的 node，改用 PATH 中的 node（或安裝時記錄的路徑） */
function locateNode(): string {
  if (!/worktrail-launcher/i.test(process.execPath)) return process.execPath;
  const recorded = join(dirname(process.execPath), 'node-path.txt');
  if (existsSync(recorded)) {
    const p = readFileSync(recorded, 'utf8').trim();
    if (p && existsSync(p)) return p;
  }
  return 'node';
}

/** 服務尚未啟動時，從設定檔取得 UI 埠號與主題 */
function configuredUi(): { port: number; theme: string } {
  const root = storageRoot();
  if (!root) return { port: 4870, theme: 'light' };
  const { config } = loadConfig(new StoragePaths(root));
  return { port: config.ui.port, theme: config.ui.theme };
}

async function waitReady(timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = readDaemonInfo();
    if (info && (await isDaemonRunning(info))) return info.port;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

export async function launcherMain(args: string[]): Promise<void> {
  const background = args.includes('--background');
  const cli = locateCli();
  process.env.WORKTRAIL_CLI = cli;

  const info = readDaemonInfo();
  if (info && (await isDaemonRunning(info))) {
    if (!isOutdated(info, cli)) {
      if (!background) await openAppWindow(uiUrl(info.port));
      return;
    }
    await stopDaemon().catch(() => false);
  }

  const child = spawn(locateNode(), [cli, 'start', '--foreground'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => undefined);
  child.unref();

  // 規格 11.6 第 3 步：等待期間先顯示啟動畫面；服務就緒後由畫面自動切換到 UI
  const splash = join(dirname(cli), 'ui', 'splash.html');
  if (!background && existsSync(splash)) {
    const { port, theme } = configuredUi();
    // 過場頁的 color-scheme 寫死在檔案裡（避免開啟時先依系統配色畫一格），深色主題用建置產生的 splash-dark.html
    const dark = join(dirname(cli), 'ui', 'splash-dark.html');
    const file = theme === 'dark' && existsSync(dark) ? dark : splash;
    await openAppWindow(`${pathToFileURL(file).href}?port=${port}&theme=${theme}`);
    return;
  }

  const port = await waitReady(10_000);
  if (port === null) {
    if (!background) showError('Worktrail 服務在 10 秒內沒有回應。可能原因：尚未安裝、埠號被占用，或設定檔有誤。', true);
    return;
  }
  if (!background) await openAppWindow(uiUrl(port));
}

const entry = process.argv[1] ?? '';
if (/launcher\.(c?js|ts)$/.test(entry) || /worktrail-launcher/i.test(process.execPath)) {
  void launcherMain(process.argv.slice(2)).then(() => setTimeout(() => process.exit(0), 300));
}
