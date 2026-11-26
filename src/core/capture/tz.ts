/** 不依賴第三方套件的時區工具（以 Intl 實作）。 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parts(ts: number, tz: string): Parts {
  const p: Record<string, number> = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ts))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return {
    year: p.year!,
    month: p.month!,
    day: p.day!,
    hour: p.hour!,
    minute: p.minute!,
    second: p.second!,
  };
}

/** 該時間點在時區中相對 UTC 的位移（毫秒） */
export function tzOffsetMs(ts: number, tz: string): number {
  const p = parts(ts, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 以「每小時」為單位快取時區位移；時區變動（日光節約）都發生在整點或半點，誤差可忽略 */
const offsetCache = new Map<string, number>();
const HOUR = 3_600_000;

function cachedOffset(ts: number, tz: string): number {
  const key = `${tz}|${Math.floor(ts / HOUR)}`;
  let off = offsetCache.get(key);
  if (off === undefined) {
    // 以該小時的起點與終點各算一次，若不同（跨日光節約）則不快取
    const start = Math.floor(ts / HOUR) * HOUR;
    const a = tzOffsetMs(start, tz);
    const b = tzOffsetMs(start + HOUR - 1000, tz);
    if (a !== b) return tzOffsetMs(ts, tz);
    off = a;
    if (offsetCache.size > 50_000) offsetCache.clear();
    offsetCache.set(key, off);
  }
  return off;
}

/** 時間點在時區中的日期 YYYY-MM-DD */
export function localDate(ts: number, tz: string): string {
  const d = new Date(ts + cachedOffset(ts, tz));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 時區中某日期 00:00 的 epoch 毫秒 */
export function startOfLocalDay(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // 以兩次迭代修正位移（處理日光節約時間交界）
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** 日期字串加減天數 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 時間點之後（嚴格大於）的下一個本地午夜 */
export function nextLocalMidnight(ts: number, tz: string): number {
  return startOfLocalDay(addDays(localDate(ts, tz), 1), tz);
}

/** 格式化為含時區位移的 ISO 8601，例如 2026-11-12T09:40:12+08:00 */
export function toIsoInTz(ts: number, tz: string): string {
  const p = parts(ts, tz);
  const off = Math.round(tzOffsetMs(ts, tz) / 60000);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
