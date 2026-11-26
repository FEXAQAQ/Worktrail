/**
 * 報告頁用到的整理：報告清單（每期的狀態與任務數）、績效的每週時數、手動編輯後的報告內容。
 */
import { formatPeriod, periodId, periodsBetween, weeksIn, type Period } from '../period/index.js';
import type { Config } from '../schema/config.js';
import type { ReportType } from '../schema/report.js';
import type { Task } from '../schema/task.js';
import type { StoragePaths } from '../storage/paths.js';
import { currentSources, isReportStale } from './prepare.js';
import { countInRange, type ReportSource } from './source.js';
import type { ReportRecord } from './store.js';

export type ReportStatus = 'none' | 'generated' | 'edited' | 'stale';

export interface ReportListItem {
  id: string;
  period: Period;
  label: string;
  status: ReportStatus;
  task_count: number;
}

export function reportStatus(paths: StoragePaths, r: ReportRecord | undefined, source?: ReportSource): ReportStatus {
  if (!r) return 'none';
  return isReportStale(paths, r, source) ? 'stale' : r.edited ? 'edited' : 'generated';
}

/**
 * 從第一筆任務到今天的每一期（含尚未產生的），加上不在期間清單中的報告（例如自訂期間），依起日由新到舊。
 * taskDates 為所有任務的日期（不需排序、可重複）。
 */
export function listReportPeriods(args: {
  paths: StoragePaths;
  config: Config;
  type: ReportType;
  taskDates: readonly string[];
  today: string;
  source: ReportSource;
}): ReportListItem[] {
  const { paths, config, type, source } = args;
  const dates = [...args.taskDates].sort();
  const existing = new Map(source.reports(type).map((r) => [r.id, r]));
  const periods = periodsBetween(type, dates[0] ?? args.today, args.today, config);
  const list: ReportListItem[] = periods.map((p) => {
    const id = periodId(type, p, config);
    const r = existing.get(id);
    existing.delete(id);
    return { id, period: p, label: formatPeriod(p), status: reportStatus(paths, r, source), task_count: countInRange(dates, p.start, p.end) };
  });
  for (const r of existing.values()) {
    const p = { start: r.period_start, end: r.period_end };
    list.push({ id: r.id, period: p, label: formatPeriod(p), status: reportStatus(paths, r, source), task_count: 0 });
  }
  return list.sort((a, b) => b.period.start.localeCompare(a.period.start));
}

/** 績效期間內、到今天為止每週的時數（四捨五入到小數兩位） */
export function weeklyHours(
  period: Period,
  config: Config,
  tasks: readonly Pick<Task, 'date' | 'hours'>[],
  today: string,
): { id: string; start: string; hours: number }[] {
  return weeksIn(period, config)
    .filter((w) => w.start <= today)
    .map((w) => ({
      id: periodId('weekly', w, config),
      start: w.start,
      hours: Math.round(tasks.filter((t) => t.date >= w.start && t.date <= w.end).reduce((a, t) => a + t.hours, 0) * 100) / 100,
    }));
}

/** 使用者在 UI 手動儲存報告內容：保留原本的產生資訊，標為已編輯；沒有原報告時以手動建立 */
export function editedReport(args: {
  paths: StoragePaths;
  type: ReportType;
  id: string;
  period: Period;
  existing: ReportRecord | null;
  content: string;
  now: Date;
  source?: ReportSource;
}): Omit<ReportRecord, 'path' | 'version'> {
  const { paths, type, id, period, existing: r } = args;
  return {
    schema: 1,
    type,
    id,
    period_start: period.start,
    period_end: period.end,
    prompt: r?.prompt ?? 'manual',
    prompt_hash: r?.prompt_hash ?? 'manual',
    sources: r?.sources ?? [],
    sources_version: r?.sources_version ?? currentSources(paths, type, period, args.source).version,
    stats: r?.stats ?? {},
    generated_at: r?.generated_at ?? args.now.toISOString().replace(/\.\d+Z$/, 'Z'),
    edited: true,
    stale: r?.stale ?? false,
    body: args.content,
  };
}
