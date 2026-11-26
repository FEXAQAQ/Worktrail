/**
 * 程式本身的位置（安裝時寫入 hook 與 MCP 指令的絕對路徑）。
 * 原始碼（tsx）與打包後（dist/*.cjs）都能找到套件根目錄。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

export function packageRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return (cached = dir);
    dir = dirname(dir);
  }
  return (cached = process.cwd());
}

export const distDir = () => join(packageRoot(), 'dist');
export const cliEntry = () => join(distDir(), 'cli.cjs');
export const hookEntry = () => join(distDir(), 'hook.cjs');
export const uiDir = () => join(distDir(), 'ui');
export const launcherExe = () => join(distDir(), 'worktrail-launcher.exe');
export const launcherScript = () => join(distDir(), 'launcher.cjs');
export const VERSION = '0.1.0';

/** 指令中的路徑加上引號（Windows 路徑可能含空白） */
export const q = (p: string) => `"${p}"`;
