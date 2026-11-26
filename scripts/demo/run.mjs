/**
 * 重新錄製 README 的示範 GIF：產生虛構資料 → 以獨立的 WORKTRAIL_HOME 啟動示範服務 → 截圖編碼 → 停止服務。
 * 用法：npm run demo:gif　（需先 npm run build；輸出 docs/images/demo.gif）
 * 環境變數：DEMO_PORT（預設 4879）、DEMO_TODAY（YYYY-MM-DD，預設今天）、DEMO_BROWSER（瀏覽器路徑）、DEMO_OUT（輸出路徑）
 * 全程使用系統暫存資料夾，不碰真實的 ~/.worktrail、~/.claude 與日誌。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORK = join(tmpdir(), 'worktrail-demo');
const DATA = join(WORK, 'data');
const OUT = resolve(process.env.DEMO_OUT || join(ROOT, 'docs/images/demo.gif'));
const CLI = join(ROOT, 'dist/cli.cjs');
const TSX = join(ROOT, 'node_modules/tsx/dist/cli.mjs');

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`執行失敗：node ${args.join(' ')}`);
};

if (!existsSync(CLI)) throw new Error('找不到 dist/cli.cjs，請先執行 npm run build');

console.log('1/3 產生虛構資料…');
run([TSX, 'scripts/demo/seed.mts', DATA]);
const info = JSON.parse(readFileSync(join(DATA, 'env.json'), 'utf8'));
const env = { WORKTRAIL_HOME: info.home, CLAUDE_CONFIG_DIR: info.claude };

console.log(`2/3 啟動示範服務（埠 ${info.port}）…`);
run([CLI, 'start'], env);
try {
  console.log('3/3 錄製畫面…');
  run([join(ROOT, 'scripts/demo/record.mjs'), `http://localhost:${info.port}`, OUT, join(WORK, 'shots'), info.weekly]);
} finally {
  spawnSync(process.execPath, [CLI, 'stop'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, ...env } });
}
