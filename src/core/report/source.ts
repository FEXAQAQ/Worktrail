/**
 * 報告的資料來源：任務與已產生的報告。
 * 預設直接讀檔；daemon 改用記憶體索引與報告快取，避免報告清單、搜尋每次都重讀所有檔案。
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportType } from '../schema/report.js';
import type { StoragePaths } from '../storage/paths.js';
import { listTasks, type TaskRecord } from '../storage/tasks.js';
import { listReports, readReport, type ReportRecord } from './store.js';

export interface ReportSource {
  /** 期間內（含頭尾）的任務，依日期、首次活動由舊到新 */
  tasks(from: string, to: string): TaskRecord[];
  /** 某類型的所有報告，依期間起日由新到舊 */
  reports(type: ReportType): ReportRecord[];
}

export function fileReportSource(paths: StoragePaths): ReportSource {
  return {
    tasks: (from, to) => listTasks(paths, from, to),
    reports: (type) => listReports(paths, type),
  };
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  record: ReportRecord | null;
}

/**
 * 報告檔快取：每次仍列出資料夾並 stat 每個檔案，但只有修改時間或大小變動的檔案才重新讀取與解析。
 * 不依賴檔案監看，外部程式（MCP、手動編輯）改檔後下一次查詢就會反映。
 */
export class ReportFileCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly paths: StoragePaths) {}

  list(type: ReportType): ReportRecord[] {
    const dir = this.paths.reportDir(type);
    if (!existsSync(dir)) return [];
    const out: ReportRecord[] = [];
    const seen = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const path = join(dir, f);
      seen.add(path);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue; // 列出後被刪除
      }
      let e = this.entries.get(path);
      if (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size) {
        e = { mtimeMs: st.mtimeMs, size: st.size, record: readReport(path) };
        this.entries.set(path, e);
      }
      if (e.record) out.push(e.record);
    }
    for (const p of this.entries.keys()) if (p.startsWith(dir) && !seen.has(p)) this.entries.delete(p);
    return out.sort((a, b) => b.period_start.localeCompare(a.period_start));
  }
}

/** 依期間標籤或內文搜尋報告（不分大小寫），每種類型最多 limit 筆 */
export function searchReports(
  source: ReportSource,
  q: string,
  limit = 10,
): { type: ReportType; id: string; period: { start: string; end: string } }[] {
  const lower = q.trim().toLowerCase();
  if (!lower) return [];
  return (['weekly', 'performance'] as const).flatMap((type) =>
    source
      .reports(type)
      .filter((r) => r.id.toLowerCase().includes(lower) || r.body.toLowerCase().includes(lower))
      .slice(0, limit)
      .map((r) => ({ type, id: r.id, period: { start: r.period_start, end: r.period_end } })),
  );
}

/** 已排序（由舊到新）的日期中，落在 from～to（含頭尾）的筆數 */
export function countInRange(sortedDates: string[], from: string, to: string): number {
  const lowerBound = (x: string, inclusive: boolean) => {
    let lo = 0;
    let hi = sortedDates.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inclusive ? sortedDates[mid]! <= x : sortedDates[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return Math.max(0, lowerBound(to, true) - lowerBound(from, false));
}
