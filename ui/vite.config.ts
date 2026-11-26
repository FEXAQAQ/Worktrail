import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** 開發模式：從 ~/.worktrail/daemon.json 讀取執行中服務的 token 與埠號，注入頁面並代理 /api */
function daemonInfo(): { port: number; token: string } | null {
  try {
    const home = process.env.WORKTRAIL_HOME || join(homedir(), '.worktrail');
    return JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
  } catch {
    return null;
  }
}

const injectToken = (): Plugin => ({
  name: 'worktrail-dev-token',
  apply: 'serve',
  transformIndexHtml(html) {
    const info = daemonInfo();
    return info ? html.replace('</head>', `<script>window.__WORKTRAIL__=${JSON.stringify(info)}</script></head>`) : html;
  },
});

const port = daemonInfo()?.port ?? 4870;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), injectToken()],
  build: { outDir: '../dist/ui', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://localhost:${port}`, changeOrigin: true } },
  },
});
