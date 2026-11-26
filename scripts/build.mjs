/**
 * 建置：以 esbuild 將 CLI、hook、啟動器各打包成單一 .cjs（hook 啟動更快），再以 Vite 建置 UI。
 * 用法：node scripts/build.mjs [--no-ui]
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const noUi = process.argv.includes('--no-ui');

// 不清空 dist：保留 worktrail-launcher.exe 與 node-path.txt（捷徑指向它們）；dist/ui 由 Vite 自行清空
mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'import.meta.url': '__importMetaUrl' },
  // Node 22+ 的編譯快取：hook 每回合都會啟動，重複執行時省下編譯時間
  banner: {
    js: "try { require('node:module').enableCompileCache?.(); } catch {}\nconst __importMetaUrl = require('url').pathToFileURL(__filename).href;",
  },
};

await Promise.all([
  build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.cjs' }),
  build({ ...common, entryPoints: ['src/hook/main.ts'], outfile: 'dist/hook.cjs' }),
  build({ ...common, entryPoints: ['src/launcher/main.ts'], outfile: 'dist/launcher.cjs' }),
]);
console.log('✓ dist/cli.cjs、dist/hook.cjs、dist/launcher.cjs');

if (!noUi) {
  execSync('npx vite build', { cwd: 'ui', stdio: 'inherit' });
  // 深色主題用的過場頁：color-scheme 要在頁面裡寫死，否則開啟時會先依系統配色畫一格（見 ui/public/splash.html）
  const splash = readFileSync('dist/ui/splash.html', 'utf8');
  const meta = '<meta name="color-scheme" content="light" />';
  if (!splash.includes(meta)) throw new Error('splash.html 找不到 color-scheme meta，無法產生 splash-dark.html');
  writeFileSync('dist/ui/splash-dark.html', splash.replace(meta, '<meta name="color-scheme" content="dark" />'));
  console.log('✓ dist/ui');
}
