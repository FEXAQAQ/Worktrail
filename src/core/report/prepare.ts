/**
 * 規格 7.5、9：報告的準備（選資料、算統計、填範本）與儲存。週報與績效共用。
 */
import { createHash } from 'node:crypto';
import { formatPeriod, periodId, resolvePeriod, weeksIn, type Period, type PeriodSpec } from '../period/index.js';
import { loadPrompt, renderTemplate, splitRef } from '../prompt/index.js';
import { parseFrontmatter } from '../storage/frontmatter.js';
import { shortHash } from '../storage/fsutil.js';
import { formatRecords, formatStats } from '../prompt/format.js';
import type { Config } from '../schema/config.js';
import type { ReportType } from '../schema/report.js';
import { computeStats, type Stats } from '../stats/index.js';
import type { StoragePaths } from '../storage/paths.js';
import { getReport, writeReport, type ReportRecord } from './store.js';
import { fileReportSource, type ReportSource } from './source.js';

export interface PreparedReport {
  type: ReportType;
  id: string;
  period: Period;
  prompt_name: string;
  prompt_hash: string;
  rendered_prompt: string;
  stats: Stats;
  sources: string[];
  sources_version: string;
  warnings: string[];
  /** 績效：缺少週報的週 */
  missing_weeks?: Period[];
}

/** 來源的雜湊：任何來源新增、刪除、修改都會改變 */
export function sourcesVersion(items: { id: string; version: string }[]): string {
  const h = createHash('sha1');
  for (const i of [...items].sort((a, b) => a.id.localeCompare(b.id))) h.update(`${i.id}:${i.version}\n`);
  return h.digest('hex').slice(0, 12);
}

function weeklyReportsIn(source: ReportSource, p: Period): ReportRecord[] {
  return source
    .reports('weekly')
    .filter((r) => r.period_start <= p.end && r.period_end >= p.start)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
}

/** 目前來源的版本（判斷報告是否過期） */
export function currentSources(
  paths: StoragePaths,
  type: ReportType,
  p: Period,
  source: ReportSource = fileReportSource(paths),
): { ids: string[]; version: string } {
  if (type === 'weekly') {
    const tasks = source.tasks(p.start, p.end);
    return { ids: tasks.map((t) => t.id), version: sourcesVersion(tasks) };
  }
  const reports = weeklyReportsIn(source, p);
  return { ids: reports.map((r) => r.id), version: sourcesVersion(reports) };
}

export function isReportStale(paths: StoragePaths, r: ReportRecord, source?: ReportSource): boolean {
  if (r.stale) return true;
  if (!r.sources_version) return false;
  return currentSources(paths, r.type, { start: r.period_start, end: r.period_end }, source).version !== r.sources_version;
}

export function prepareReport(args: {
  paths: StoragePaths;
  config: Config;
  type: ReportType;
  period?: PeriodSpec;
  prompt?: string;
  /** 試跑尚未儲存的範本：以此內容（含前段 YAML）取代範本檔 */
  templateText?: string;
  today: string;
  /** 資料來源，預設直接讀檔 */
  source?: ReportSource;
}): PreparedReport {
  const { paths, config, type } = args;
  const source = args.source ?? fileReportSource(paths);
  const period = resolvePeriod(type, args.period, config, args.today);
  const id = periodId(type, period, config);
  const promptRef =
    args.prompt ?? (type === 'weekly' ? config.report.weekly.default_prompt : config.report.performance.default_prompt);
  const ref = promptRef.includes('/') ? promptRef : `${type}/${promptRef}`;
  const prompt =
    args.templateText !== undefined
      ? { ref, type: splitRef(ref).type, body: parseFrontmatter(args.templateText).body.trim(), hash: shortHash(args.templateText) }
      : loadPrompt(paths, ref);
  if (prompt.type !== type) throw new Error(`範本 ${prompt.ref} 不是 ${type} 類型`);

  const tasks = source.tasks(period.start, period.end);
  const stats = computeStats(tasks);
  const warnings: string[] = [];
  const pending = tasks.filter((t) => t.summary_status !== 'done').length;
  if (pending) warnings.push(`${pending} 個任務待補摘要`);

  let records: string;
  let sources: string[];
  let version: string;
  let missing_weeks: Period[] | undefined;

  if (type === 'weekly') {
    if (!tasks.length) warnings.push('本期間沒有任何任務紀錄');
    records = formatRecords(tasks);
    sources = tasks.map((t) => t.id);
    version = sourcesVersion(tasks);
  } else {
    const weeklies = weeklyReportsIn(source, period);
    const have = new Set(weeklies.map((r) => r.period_start));
    // 只檢查有任務的週：沒有工作的週不需要週報
    missing_weeks = weeksIn(period, config).filter(
      (w) => !have.has(w.start) && tasks.some((t) => t.date >= w.start && t.date <= w.end) && w.end < args.today,
    );
    for (const w of missing_weeks) warnings.push(`${periodId('weekly', w, config)}（${formatPeriod(w)}）缺少週報`);
    const stale = weeklies.filter((r) => isReportStale(paths, r, source));
    if (stale.length) warnings.push(`${stale.map((r) => r.id).join('、')} 週報的來源資料在產生後有變動`);
    records = weeklies.length
      ? weeklies.map((r) => `## 週報 ${r.id}（${formatPeriod({ start: r.period_start, end: r.period_end })}）\n\n${r.body.trim()}`).join('\n\n---\n\n')
      : '（本期間沒有週報）';
    sources = weeklies.map((r) => r.id);
    version = sourcesVersion(weeklies);
  }

  const prevPeriod = resolvePeriod(type, 'previous', config, period.start);
  const previous = getReport(paths, type, periodId(type, prevPeriod, config))?.body.trim() ?? '';

  const rendered = renderTemplate(prompt.body, {
    period: formatPeriod(period),
    period_start: period.start,
    period_end: period.end,
    today: args.today,
    user_name: config.user_name || '使用者',
    records,
    stats: formatStats(stats),
    previous,
  });

  return {
    type,
    id,
    period,
    prompt_name: prompt.ref,
    prompt_hash: prompt.hash,
    rendered_prompt: rendered,
    stats,
    sources,
    sources_version: version,
    warnings,
    missing_weeks,
  };
}

export class ReportConflictError extends Error {}

export function saveReport(args: {
  paths: StoragePaths;
  config: Config;
  type: ReportType;
  period: Period;
  prompt_name: string;
  prompt_hash: string;
  sources: string[];
  stats: unknown;
  content: string;
  overwrite?: boolean;
  sources_version?: string;
}): ReportRecord {
  const { paths, config, type, period } = args;
  const id = periodId(type, period, config);
  const existing = getReport(paths, type, id);
  if (existing?.edited && !args.overwrite) {
    throw new ReportConflictError(`${id} 已被手動編輯過，需帶 overwrite=true 才會覆蓋`);
  }
  return writeReport(paths, {
    schema: 1,
    type,
    id,
    period_start: period.start,
    period_end: period.end,
    prompt: args.prompt_name,
    prompt_hash: args.prompt_hash,
    sources: args.sources,
    sources_version: args.sources_version ?? currentSources(paths, type, period).version,
    stats: (args.stats ?? {}) as Record<string, unknown>,
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    edited: false,
    stale: false,
    body: args.content.trim(),
  });
}
