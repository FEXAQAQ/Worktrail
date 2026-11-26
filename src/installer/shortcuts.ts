/**
 * 規格 11.6、13.2 第 8 步：一鍵啟動捷徑與開機自動啟動。
 *
 * Windows：以 PowerShell 呼叫 WScript.Shell COM 建立 .lnk（不使用 VBScript 檔）。
 *   捷徑目標為 worktrail-launcher.exe（GUI 子系統，不會閃出終端機視窗）。
 *   開機啟動放在「啟動」資料夾：工作排程器的 ONLOGON 工作在一般權限下常被拒絕。
 * macOS：~/Applications/Worktrail.app（殼層腳本）與 LaunchAgent。
 */
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cliEntry, launcherExe, launcherScript, packageRoot } from '../core/program.js';

export const PROJECT_LNK = '啟動 Worktrail';
import { ensureDir, writeFileAtomic } from '../core/storage/fsutil.js';

function powershell(script: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    );
  });
}

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Windows 特殊資料夾，或指定的資料夾路徑（專案資料夾內的啟動捷徑） */
type LnkFolder = 'Desktop' | 'Programs' | 'Startup' | { dir: string };
const dirExpr = (f: LnkFolder) => (typeof f === 'string' ? `[Environment]::GetFolderPath(${psq(f)})` : psq(f.dir));

interface LnkSpec {
  folder: LnkFolder;
  target: string;
  args: string;
  name: string;
  minimized?: boolean;
}

function launchTarget(nodePath: string, extraArgs = ''): { target: string; args: string; minimized: boolean } {
  if (existsSync(launcherExe())) return { target: launcherExe(), args: extraArgs, minimized: false };
  // 尚未建置啟動器時的退路：直接以 node 執行（會短暫出現最小化的視窗）
  return { target: nodePath, args: `"${launcherScript()}" ${extraArgs}`.trim(), minimized: true };
}

async function createLnk(spec: LnkSpec): Promise<string> {
  const script = [
    `$dir = ${dirExpr(spec.folder)}`,
    `$path = Join-Path $dir ${psq(`${spec.name}.lnk`)}`,
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)`,
    `$s.TargetPath = ${psq(spec.target)}`,
    `$s.Arguments = ${psq(spec.args)}`,
    `$s.WorkingDirectory = ${psq(homedir())}`,
    `$s.Description = 'Worktrail：工作日誌'`,
    spec.minimized ? '$s.WindowStyle = 7' : '$s.WindowStyle = 1',
    existsSync(launcherExe()) ? `$s.IconLocation = ${psq(`${launcherExe()},0`)}` : '',
    '$s.Save()',
    'Write-Output $path',
  ]
    .filter(Boolean)
    .join('; ');
  const r = await powershell(script);
  if (!r.ok) throw new Error(`建立捷徑失敗：${r.out}`);
  return r.out.split(/\r?\n/).pop() ?? '';
}

async function removeLnk(folder: LnkFolder, name: string): Promise<void> {
  await powershell(
    `$p = Join-Path (${dirExpr(folder)}) ${psq(`${name}.lnk`)}; if (Test-Path $p) { Remove-Item $p -Force }`,
  );
}

async function lnkExists(folder: LnkFolder, name: string): Promise<boolean> {
  const r = await powershell(`Test-Path (Join-Path (${dirExpr(folder)}) ${psq(`${name}.lnk`)})`);
  return r.out.trim() === 'True';
}

// macOS
const macApp = () => join(homedir(), 'Applications', 'Worktrail.app');
const macAgent = () => join(homedir(), 'Library', 'LaunchAgents', 'com.worktrail.daemon.plist');

function createMacApp(nodePath: string): string {
  const app = macApp();
  ensureDir(join(app, 'Contents', 'MacOS'));
  writeFileAtomic(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Worktrail</string>
<key>CFBundleIdentifier</key><string>com.worktrail.launcher</string>
<key>CFBundleExecutable</key><string>Worktrail</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
`,
  );
  const exe = join(app, 'Contents', 'MacOS', 'Worktrail');
  writeFileAtomic(exe, `#!/bin/sh\nexec "${nodePath}" "${launcherScript()}"\n`);
  chmodSync(exe, 0o755);
  return app;
}

function createMacAgent(nodePath: string): string {
  writeFileAtomic(
    macAgent(),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.worktrail.daemon</string>
<key>ProgramArguments</key><array><string>${nodePath}</string><string>${cliEntry()}</string><string>start</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`,
  );
  return macAgent();
}

export async function createShortcuts(nodePath: string): Promise<string[]> {
  if (process.platform === 'win32') {
    const t = launchTarget(nodePath);
    return [
      await createLnk({ folder: 'Desktop', name: 'Worktrail', ...t }),
      await createLnk({ folder: 'Programs', name: 'Worktrail', ...t }),
      // 專案資料夾內的一鍵啟動按鈕
      await createLnk({ folder: { dir: packageRoot() }, name: PROJECT_LNK, ...t }),
    ];
  }
  if (process.platform === 'darwin') {
    const cmd = join(packageRoot(), `${PROJECT_LNK}.command`);
    writeFileAtomic(cmd, `#!/bin/sh\nexec "${nodePath}" "${launcherScript()}"\n`);
    chmodSync(cmd, 0o755);
    return [createMacApp(nodePath), cmd];
  }
  return [];
}

export async function setAutostart(nodePath: string, enabled: boolean): Promise<string | null> {
  if (process.platform === 'win32') {
    if (!enabled) {
      await removeLnk('Startup', 'Worktrail 服務');
      return null;
    }
    const t = launchTarget(nodePath, '--background');
    return createLnk({ folder: 'Startup', name: 'Worktrail 服務', ...t, minimized: true });
  }
  if (process.platform === 'darwin') {
    if (!enabled) {
      rmSync(macAgent(), { force: true });
      return null;
    }
    return createMacAgent(nodePath);
  }
  return null;
}

export async function removeShortcuts(): Promise<void> {
  if (process.platform === 'win32') {
    await removeLnk('Desktop', 'Worktrail');
    await removeLnk('Programs', 'Worktrail');
    await removeLnk('Startup', 'Worktrail 服務');
    await removeLnk({ dir: packageRoot() }, PROJECT_LNK);
  } else if (process.platform === 'darwin') {
    rmSync(macApp(), { recursive: true, force: true });
    rmSync(macAgent(), { force: true });
    rmSync(join(packageRoot(), `${PROJECT_LNK}.command`), { force: true });
  }
}

export async function shortcutStatus(): Promise<{ shortcut: boolean; autostart: boolean }> {
  if (process.platform === 'win32') {
    return { shortcut: await lnkExists('Desktop', 'Worktrail'), autostart: await lnkExists('Startup', 'Worktrail 服務') };
  }
  if (process.platform === 'darwin') return { shortcut: existsSync(macApp()), autostart: existsSync(macAgent()) };
  return { shortcut: false, autostart: false };
}
