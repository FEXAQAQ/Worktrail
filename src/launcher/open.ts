/**
 * 規格 11.6 第 4 步：以獨立應用程式視窗開啟 UI。
 * Windows：Edge app 模式；macOS：Chrome 或 Edge app 模式；都沒有時用預設瀏覽器。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function candidates(): string[] {
  if (process.platform === 'win32') {
    const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[];
    return pf.flatMap((d) => [
      join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
}

export async function openAppWindow(url: string): Promise<void> {
  const browser = candidates().find((p) => existsSync(p));
  if (browser) {
    spawn(browser, [`--app=${url}`, '--window-size=1280,860'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return;
  }
  openDefault(url);
}

export function openDefault(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** 在系統的檔案總管（Finder）中開啟資料夾 */
export function openFolder(dir: string): void {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [dir], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

/** 顯示錯誤對話框（啟動器沒有主控台） */
export function showError(message: string, withDoctor: boolean): void {
  if (process.platform === 'win32') {
    const msg = message.replace(/'/g, "''");
    const script = withDoctor
      ? `Add-Type -AssemblyName PresentationFramework; $r = [System.Windows.MessageBox]::Show('${msg}' + [Environment]::NewLine + [Environment]::NewLine + '要執行診斷嗎？', 'Worktrail', 'YesNo', 'Error'); if ($r -eq 'Yes') { exit 10 } else { exit 0 }`
      : `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${msg}', 'Worktrail', 'OK', 'Error') | Out-Null`;
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, stdio: 'ignore' });
    child.on('exit', (code) => {
      if (code === 10) runDoctorWindow();
    });
  } else if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `display alert "Worktrail" message "${message.replace(/"/g, '\\"')}" as critical`], { stdio: 'ignore' });
  } else {
    console.error(message);
  }
}

/** 在可見的終端機視窗執行 worktrail doctor */
function runDoctorWindow(): void {
  const cli = process.env.WORKTRAIL_CLI;
  if (!cli) return;
  spawn('cmd.exe', ['/c', 'start', '"Worktrail 診斷"', 'cmd', '/k', `"${process.execPath}" "${cli}" doctor`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();
}
