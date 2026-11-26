/**
 * 規格 11.6：以 Node.js Single Executable Application 打包 worktrail-launcher.exe（Windows）。
 *
 * 1. 以 dist/launcher.cjs 產生 SEA blob
 * 2. 複製 node.exe 並注入 blob（postject）
 * 3. 將 PE 標頭的 Subsystem 改為 GUI（2），雙擊時不會出現終端機視窗
 *
 * 用法：node scripts/build-launcher.mjs（需先執行 npm run build）
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, openSync, readSync, rmSync, writeFileSync, writeSync, closeSync } from 'node:fs';

if (process.platform !== 'win32') {
  console.log('· 非 Windows 平台，略過啟動器打包（macOS 使用 Worktrail.app 殼層腳本）');
  process.exit(0);
}
if (!existsSync('dist/launcher.cjs')) {
  console.error('找不到 dist/launcher.cjs，請先執行 npm run build');
  process.exit(1);
}

const exe = 'dist/worktrail-launcher.exe';
const blob = 'dist/sea-prep.blob';
const cfg = 'dist/sea-config.json';

writeFileSync(cfg, JSON.stringify({ main: 'dist/launcher.cjs', output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ['--experimental-sea-config', cfg], { stdio: 'inherit' });

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
execFileSync(
  process.execPath,
  [
    'node_modules/postject/dist/cli.js',
    exe,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--overwrite',
  ],
  { stdio: 'inherit' },
);

// PE：e_lfanew 在 0x3C；Optional Header 從 e_lfanew + 24 開始；Subsystem 在其偏移 68（PE32 與 PE32+ 相同）
const fd = openSync(exe, 'r+');
const buf = Buffer.alloc(4);
readSync(fd, buf, 0, 4, 0x3c);
const peOffset = buf.readUInt32LE(0);
const sig = Buffer.alloc(4);
readSync(fd, sig, 0, 4, peOffset);
if (sig.toString('latin1') !== 'PE\0\0') throw new Error('不是有效的 PE 檔');
const subsystemOffset = peOffset + 24 + 68;
const sub = Buffer.alloc(2);
readSync(fd, sub, 0, 2, subsystemOffset);
const WINDOWS_GUI = 2;
const out = Buffer.alloc(2);
out.writeUInt16LE(WINDOWS_GUI, 0);
writeSync(fd, out, 0, 2, subsystemOffset);
closeSync(fd);

rmSync(blob, { force: true });
rmSync(cfg, { force: true });
console.log(`✓ ${exe}（Subsystem ${sub.readUInt16LE(0)} → ${WINDOWS_GUI}，不顯示終端機視窗）`);
