/**
 * 一鍵快照：把 DOM 節點轉成 PNG 並放進剪貼簿；剪貼簿不可用時改為下載。
 * 用 modern-screenshot（SVG foreignObject，由瀏覽器自己排版），支援 Tailwind 4 的 oklch 色彩與網路字型。
 */
import { domToBlob } from 'modern-screenshot';
import { SHARE_SCALE } from './share';

export async function renderPng(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  return domToBlob(node, {
    scale: SHARE_SCALE,
    type: 'image/png',
    backgroundColor: getComputedStyle(node).backgroundColor,
    timeout: 15000,
  });
}

/**
 * 寫入剪貼簿。必須在點擊事件內「同步」呼叫：ClipboardItem 直接收 Promise，
 * 圖片稍後才產生也不會失去使用者手勢（Chromium／Safari 的要求）。
 */
export function writePngToClipboard(png: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return Promise.reject(new Error('此瀏覽器不支援複製圖片'));
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export function downloadBlob(filename: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
