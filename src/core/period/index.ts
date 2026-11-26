/**
 * 規格 9.2：週與績效期間計算（純函式，以 YYYY-MM-DD 字串運算）。
 */
import { addDays } from '../capture/tz.js';
import type { Config } from '../schema/config.js';
import type { ReportType } from '../schema/report.js';

export interface Period {
  start: string;
  end: string;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** 0=週日 … 6=週六 */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

export function weekOf(date: string, startDay: Config['report']['weekly']['start_day']): Period {
  const startIdx = DAYS.indexOf(startDay);
  const back = (weekday(date) - startIdx + 7) % 7;
  const start = addDays(date, -back);
  return { start, end: addDays(start, 6) };
}

/** 未設定 anchor_date 時的預設週期起點 */
export const DEFAULT_CYCLE_ANCHOR = '2026-01-05';

/**
 * 包含 date 的週報期間：以 start_day 對齊，每 length_weeks 週一期；
 * 多週一期時以 anchor_date 所在週為某一期的第一週。
 */
export function weeklyPeriodOf(date: string, weekly: Config['report']['weekly']): Period {
  const w = weekOf(date, weekly.start_day);
  const n = weekly.length_weeks;
  if (n <= 1) return w;
  const anchor = weekOf(weekly.anchor_date || DEFAULT_CYCLE_ANCHOR, weekly.start_day).start;
  const weeks = Math.round((Date.parse(w.start) - Date.parse(anchor)) / (7 * 86_400_000));
  const idx = ((weeks % n) + n) % n;
  const start = addDays(w.start, -7 * idx);
  return { start, end: addDays(start, 7 * n - 1) };
}

/** ISO 週次（週一為起點）：以該週的週四所在年份為週年 */
export function isoWeek(date: string): { year: number; week: number } {
  const monday = weekOf(date, 'monday').start;
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week1Monday = weekOf(jan4, 'monday').start;
  const diff = (Date.parse(monday) - Date.parse(week1Monday)) / (7 * 86_400_000);
  return { year, week: Math.round(diff) + 1 };
}

function isoWeekStart(year: number, week: number): string {
  return addDays(weekOf(`${year}-01-04`, 'monday').start, (week - 1) * 7);
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function monthRange(y: number, m: number, months: number): Period {
  const endM0 = m - 1 + months - 1;
  const ey = y + Math.floor(endM0 / 12);
  const em = (endM0 % 12) + 1;
  return { start: `${y}-${pad(m)}-01`, end: `${ey}-${pad(em)}-${pad(lastDayOfMonth(ey, em))}` };
}

type PerfPeriod = Exclude<Config['report']['performance']['period'], 'custom'>;
const MONTHS: Record<PerfPeriod, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

/** 包含 date 的績效期間；季與半年以 year_start_month 起算 */
export function performancePeriodOf(date: string, kind: PerfPeriod, yearStartMonth: number): Period {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const len = MONTHS[kind];
  if (kind === 'monthly') return monthRange(y, m, 1);
  // 考核年度起點
  const fy = m >= yearStartMonth ? y : y - 1;
  const offset = (m - yearStartMonth + 12) % 12;
  const idx = Math.floor(offset / len);
  const startM0 = yearStartMonth - 1 + idx * len;
  return monthRange(fy + Math.floor(startM0 / 12), (startM0 % 12) + 1, len);
}

/** 期間標籤，也是報告檔名（規格 9.2） */
export function periodId(type: ReportType, p: Period, config: Config): string {
  if (type === 'weekly') {
    if (config.report.weekly.start_day === 'monday' && weekday(p.start) === 1 && addDays(p.start, 6) === p.end) {
      const { year, week } = isoWeek(p.start);
      return `${year}-W${pad(week)}`;
    }
    return `${p.start}_${p.end}`;
  }
  const { period: kind, year_start_month: ysm } = config.report.performance;
  const y = Number(p.start.slice(0, 4));
  const m = Number(p.start.slice(5, 7));
  const fyPrefix = ysm === 1 ? `${y}` : `FY${m >= ysm ? y : y - 1}`;
  if (kind !== 'custom') {
    const canonical = performancePeriodOf(p.start, kind, ysm);
    if (canonical.start === p.start && canonical.end === p.end) {
      const idx = Math.floor(((m - ysm + 12) % 12) / MONTHS[kind]) + 1;
      if (kind === 'monthly') return `${y}-${pad(m)}`;
      if (kind === 'quarterly') return `${fyPrefix}-Q${idx}`;
      if (kind === 'half_yearly') return `${fyPrefix}-H${idx}`;
      return ysm === 1 ? `${y}` : fyPrefix;
    }
  }
  return `${p.start}_${p.end}`;
}

/** 由期間標籤還原日期範圍；無法辨識時回傳 null */
export function parsePeriodId(type: ReportType, id: string, config: Config): Period | null {
  let m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (m) return m[1]! <= m[2]! ? { start: m[1]!, end: m[2]! } : null;
  if (type === 'weekly') {
    m = /^(\d{4})-W(\d{2})$/.exec(id);
    if (!m) return null;
    const start = isoWeekStart(Number(m[1]), Number(m[2]));
    return { start, end: addDays(start, 6) };
  }
  const ysm = config.report.performance.year_start_month;
  if ((m = /^(\d{4})-(\d{2})$/.exec(id))) return monthRange(Number(m[1]), Number(m[2]), 1);
  if ((m = /^(FY)?(\d{4})-([QH])(\d)$/.exec(id))) {
    const len = m[3] === 'Q' ? 3 : 6;
    const startM0 = (m[1] ? ysm : 1) - 1 + (Number(m[4]) - 1) * len;
    const fy = Number(m[2]);
    return monthRange(fy + Math.floor(startM0 / 12), (startM0 % 12) + 1, len);
  }
  if ((m = /^(FY)?(\d{4})$/.exec(id))) return monthRange(Number(m[2]), m[1] ? ysm : 1, 12);
  return null;
}

export type PeriodSpec = 'current' | 'previous' | Period;

/** 依 current／previous／指定範圍取得期間 */
export function resolvePeriod(type: ReportType, spec: PeriodSpec | undefined, config: Config, today: string): Period {
  if (spec && typeof spec === 'object') return spec;
  const which = spec ?? 'current';
  if (type === 'weekly') {
    const cur = weeklyPeriodOf(today, config.report.weekly);
    return which === 'current' ? cur : weeklyPeriodOf(addDays(cur.start, -1), config.report.weekly);
  }
  const { period: kind, year_start_month: ysm } = config.report.performance;
  const k: PerfPeriod = kind === 'custom' ? 'monthly' : kind;
  const cur = performancePeriodOf(today, k, ysm);
  return which === 'current' ? cur : performancePeriodOf(addDays(cur.start, -1), k, ysm);
}

/** 解析使用者輸入的期間（slash command 參數）：current、previous、YYYY-MM-DD~YYYY-MM-DD、期間標籤 */
export function parsePeriodArg(type: ReportType, arg: string | undefined, config: Config): PeriodSpec | undefined {
  if (!arg) return undefined;
  const a = arg.trim();
  if (a === 'current' || a === 'previous') return a;
  const m = /^(\d{4}-\d{2}-\d{2})\s*[~～]\s*(\d{4}-\d{2}-\d{2})$/.exec(a);
  if (m) return { start: m[1]!, end: m[2]! };
  return parsePeriodId(type, a, config) ?? undefined;
}

/** 與範圍重疊的所有週報期間（績效檢查缺少週報、週趨勢用）；多週一期時每項為一整期 */
export function weeksIn(p: Period, config: Config): Period[] {
  const out: Period[] = [];
  const step = 7 * config.report.weekly.length_weeks;
  let w = weeklyPeriodOf(p.start, config.report.weekly);
  while (w.start <= p.end) {
    out.push(w);
    w = { start: addDays(w.start, step), end: addDays(w.end, step) };
  }
  return out;
}

/** 從 from 到 to（含）的期間清單，新的在前（UI 左欄用） */
export function periodsBetween(type: ReportType, from: string, to: string, config: Config): Period[] {
  const out: Period[] = [];
  let p = resolvePeriod(type, 'current', config, to);
  for (let i = 0; i < 520 && p.end >= from; i++) {
    out.push(p);
    p = resolvePeriod(type, 'previous', config, p.start);
  }
  return out;
}

export function formatPeriod(p: Period): string {
  return `${p.start} ～ ${p.end}`;
}
