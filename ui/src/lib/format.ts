import type { ItemStatus } from './api';

export { displayTitle, STATUS_LABEL } from './task-text';

export const STATUS_ORDER: ItemStatus[] = ['done', 'pending', 'todo', 'skipped', 'blocked'];

export const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日（${WEEKDAY[weekdayOf(date)]}）`;
}

export function formatDateShort(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEKDAY[weekdayOf(date)]}）`;
}

export const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}h`;

export const hhmm = (iso?: string) => (iso ? iso.slice(11, 16) : '--:--');

export const pct = (r: number | null | undefined) => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`);

export function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

export function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
