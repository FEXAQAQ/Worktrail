/**
 * 任務文字的純函式（不依賴 DOM 與其他 UI 模組），供 UI 與單元測試共用。
 */

/** 與 api.ts 的 ItemStatus 相同；這個檔案不引入其他模組，讓後端測試能直接載入 */
type ItemStatus = 'done' | 'pending' | 'todo' | 'skipped' | 'blocked';

export const STATUS_LABEL: Record<ItemStatus, string> = {
  done: '完成',
  pending: '待進行',
  todo: '未開始',
  skipped: '暫不處理',
  blocked: '卡住',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 單號已在前面一欄，標題開頭重複的單號（含 [TDDA-1]、TDDA-1：等寫法）只在畫面上拿掉 */
export function displayTitle(t: { title: string; ticket: string | null }): string {
  if (!t.ticket) return t.title;
  const re = new RegExp(`^\\s*[\\[【(（]?${escapeRe(t.ticket)}[\\]】)）]?[\\s:：\\-–—｜|]*`, 'i');
  return t.title.replace(re, '').trim();
}
