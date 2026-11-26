/**
 * 一鍵快照（分享卡片）的純函式：不碰 DOM，供單元測試。見 DECISIONS.md「一鍵快照」。
 */

/** 分享卡片的版面寬度（CSS px）；輸出時乘上 SHARE_SCALE */
export const SHARE_WIDTH = 720;
export const SHARE_SCALE = 2;
/**
 * Telegram 傳「壓縮圖片」時最長邊約 2560 px。卡片輸出寬 1440 px，
 * 高度超過 2560 CSS px（輸出 5120 px）後會被縮到寬不到 720 px，文字就難以閱讀。
 */
export const SHARE_LONG_LIMIT = 2560;

export function isTooLongForTelegram(cssHeight: number): boolean {
  return cssHeight > SHARE_LONG_LIMIT;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 卡片頁尾的時間戳：YYYY-MM-DD HH:mm（本機時間） */
export function formatStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 下載用檔名：去掉 Windows／macOS 不允許的字元，加上時間戳 */
export function shareFileName(title: string, d: Date): string {
  const safe = title.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'worktrail';
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${safe}-${stamp}.png`;
}

/**
 * 報告內文常以「# 週報 2026-W46」開頭，和卡片標題重複。
 * 開頭（略過空行）是一級標題時拆出來，回傳標題與剩下的內文；否則 heading 為 null。
 */
export function splitLeadingHeading(text: string): { heading: string | null; body: string } {
  const m = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(text);
  if (!m?.[1]) return { heading: null, body: text };
  return { heading: m[1].trim(), body: text.slice(m[0].length).replace(/^\s*\n/, '') };
}
