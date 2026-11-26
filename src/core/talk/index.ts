/**
 * 小交流：勾選幾天的工作紀錄，整理成一眼看懂的簡短重點（規格未涵蓋，見 DECISIONS.md）。
 *
 * 與週報共用範本機制（prompt 類型 talk）、紀錄格式與統計；差別在期間是任意勾選的日期，
 * 所以每份小交流以建立時間為 id，存在 `<storage>/talk/<id>.md`。
 */
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { toIsoInTz } from '../capture/tz.js';
import { WEEKDAY_ZH, weekday, type Period } from '../period/index.js';
import { formatRecords, formatStats } from '../prompt/format.js';
import { loadPrompt, renderTemplate, splitRef } from '../prompt/index.js';
import { sourcesVersion } from '../report/prepare.js';
import type { Config } from '../schema/config.js';
import { IsoDate } from '../schema/task.js';
import { TalkFrontmatter, type Talk } from '../schema/talk.js';
import { computeStats, type Stats } from '../stats/index.js';
import { parseFrontmatter, stringifyFrontmatter } from '../storage/frontmatter.js';
import { contentVersion, ensureDir, readText, shortHash, writeFileAtomic } from '../storage/fsutil.js';
import type { StoragePaths } from '../storage/paths.js';
import { listTasks, type TaskRecord } from '../storage/tasks.js';

export interface TalkRecord extends Talk {
  id: string;
  path: string;
  version: string;
}

const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?$/;
const ORDER = ['schema', 'type', 'title', 'dates', 'prompt', 'prompt_hash', 'sources', 'sources_version', 'stats', 'created_at', 'generated_at', 'edited'];

export function isTalkId(id: string): boolean {
  return ID_RE.test(id);
}

export function talkPath(paths: StoragePaths, id: string): string {
  if (!isTalkId(id)) throw new Error(`小交流 id 不正確：${id}`);
  return join(paths.talk, `${id}.md`);
}

/** 排序、去重並檢查日期格式 */
export function normalizeDates(dates: readonly string[]): string[] {
  for (const d of dates) IsoDate.parse(d);
  return [...new Set(dates)].sort();
}

export function readTalk(path: string): TalkRecord | null {
  const text = readText(path);
  if (text === null) return null;
  const { data, body } = parseFrontmatter(text);
  const r = TalkFrontmatter.safeParse(data);
  if (!r.success) return null;
  return { ...r.data, body, id: basename(path, '.md'), path, version: contentVersion(text) };
}

export function getTalk(paths: StoragePaths, id: string): TalkRecord | null {
  return isTalkId(id) ? readTalk(talkPath(paths, id)) : null;
}

export function writeTalk(paths: StoragePaths, t: Omit<TalkRecord, 'path' | 'version'>): TalkRecord {
  const { body, id, ...fm } = t;
  const ordered: Record<string, unknown> = {};
  for (const k of ORDER) if ((fm as Record<string, unknown>)[k] !== undefined) ordered[k] = (fm as Record<string, unknown>)[k];
  const text = stringifyFrontmatter(ordered, body);
  const path = talkPath(paths, id);
  writeFileAtomic(path, text);
  return { ...t, path, version: contentVersion(text) };
}

/** 新的在前 */
export function listTalks(paths: StoragePaths): TalkRecord[] {
  if (!existsSync(paths.talk)) return [];
  return readdirSync(paths.talk)
    .filter((f) => f.endsWith('.md') && isTalkId(f.slice(0, -3)))
    .map((f) => readTalk(join(paths.talk, f)))
    .filter((t): t is TalkRecord => !!t)
    .sort((a, b) => b.id.localeCompare(a.id));
}

export function trashTalk(paths: StoragePaths, t: TalkRecord): string {
  ensureDir(paths.trash);
  const dest = join(paths.trash, `${Date.now()}__talk__${basename(t.path)}`);
  renameSync(t.path, dest);
  return dest;
}

/** 以建立時間（設定時區）為 id：2026-11-16-1430；同一分鐘重複時加 -2、-3… */
export function newTalkId(paths: StoragePaths, now: number, tz: string): string {
  const base = toIsoInTz(now, tz).slice(0, 16).replace('T', '-').replace(':', '');
  let id = base;
  for (let i = 2; existsSync(join(paths.talk, `${id}.md`)); i++) id = `${base}-${i}`;
  return id;
}

export function createTalk(paths: StoragePaths, config: Config, args: { dates: string[]; title?: string; now?: number }): TalkRecord {
  const now = args.now ?? Date.now();
  const tz = config.time.timezone;
  return writeTalk(paths, {
    schema: 1,
    type: 'talk',
    id: newTalkId(paths, now, tz),
    title: args.title?.trim() ?? '',
    dates: normalizeDates(args.dates),
    prompt: 'manual',
    prompt_hash: 'manual',
    sources: [],
    stats: {},
    created_at: toIsoInTz(now, tz),
    edited: false,
    body: '',
  });
}

/** 勾選日期上的任務 */
export function tasksOnDates(paths: StoragePaths, dates: readonly string[]): TaskRecord[] {
  if (!dates.length) return [];
  const set = new Set(dates);
  const sorted = [...set].sort();
  return listTasks(paths, sorted[0]!, sorted[sorted.length - 1]!).filter((t) => set.has(t.date));
}

export function talkSourcesVersion(paths: StoragePaths, dates: readonly string[]): string {
  return sourcesVersion(tasksOnDates(paths, dates));
}

/** 產生後，勾選日期的任務有變動，或改了勾選日期 → 過期 */
export function isTalkStale(paths: StoragePaths, t: TalkRecord): boolean {
  if (!t.generated_at || !t.sources_version) return false;
  return talkSourcesVersion(paths, t.dates) !== t.sources_version;
}

/** 11/12（四）、11/13（五）；跨年時加上年份 */
export function formatDates(dates: readonly string[]): string {
  if (!dates.length) return '（未選擇日期）';
  const years = new Set(dates.map((d) => d.slice(0, 4)));
  return dates
    .map((d) => {
      const [y, m, day] = d.split('-').map(Number) as [number, number, number];
      return `${years.size > 1 ? `${y}/` : ''}${m}/${day}（${WEEKDAY_ZH[weekday(d)]}）`;
    })
    .join('、');
}

export function talkLabel(t: Pick<Talk, 'title' | 'dates'>): string {
  return t.title || `小交流 ${formatDates(t.dates)}`;
}

export interface PreparedTalk {
  dates: string[];
  period: Period | null;
  prompt_name: string;
  prompt_hash: string;
  rendered_prompt: string;
  stats: Stats;
  sources: string[];
  sources_version: string;
  warnings: string[];
}

export function prepareTalk(args: {
  paths: StoragePaths;
  config: Config;
  dates: readonly string[];
  prompt?: string;
  /** 試跑尚未儲存的範本 */
  templateText?: string;
  /** 目前這份小交流（找「上一次」時排除自己） */
  excludeId?: string;
  today: string;
}): PreparedTalk {
  const { paths, config } = args;
  const dates = normalizeDates(args.dates);
  if (!dates.length) throw new Error('請至少勾選一天');
  const promptRef = args.prompt ?? config.report.talk.default_prompt;
  const ref = promptRef.includes('/') ? promptRef : `talk/${promptRef}`;
  const prompt =
    args.templateText !== undefined
      ? { ref, type: splitRef(ref).type, body: parseFrontmatter(args.templateText).body.trim(), hash: shortHash(args.templateText) }
      : loadPrompt(paths, ref);
  if (prompt.type !== 'talk') throw new Error(`範本 ${prompt.ref} 不是小交流類型`);

  const tasks = tasksOnDates(paths, dates);
  const stats = computeStats(tasks);
  const warnings: string[] = [];
  if (!tasks.length) warnings.push('勾選的日期沒有任何任務紀錄');
  const pending = tasks.filter((t) => t.summary_status !== 'done').length;
  if (pending) warnings.push(`${pending} 個任務待補摘要`);
  const empty = dates.filter((d) => !tasks.some((t) => t.date === d));
  if (tasks.length && empty.length) warnings.push(`${formatDates(empty)} 沒有任務紀錄`);

  // 上一次：排除自己、最後一天早於這次第一天、有內文的小交流
  const previous =
    listTalks(paths).find((t) => t.id !== args.excludeId && t.body.trim() && t.dates.length && t.dates[t.dates.length - 1]! < dates[0]!)?.body.trim() ?? '';

  const period = { start: dates[0]!, end: dates[dates.length - 1]! };
  const rendered = renderTemplate(prompt.body, {
    dates: formatDates(dates),
    period: period.start === period.end ? period.start : `${period.start} ～ ${period.end}`,
    period_start: period.start,
    period_end: period.end,
    today: args.today,
    user_name: config.user_name || '使用者',
    records: formatRecords(tasks),
    stats: formatStats(stats),
    previous,
  });

  return {
    dates,
    period,
    prompt_name: prompt.ref,
    prompt_hash: prompt.hash,
    rendered_prompt: rendered,
    stats,
    sources: tasks.map((t) => t.id),
    sources_version: sourcesVersion(tasks),
    warnings,
  };
}

export class TalkConflictError extends Error {}

/** 存入 Claude 產生的內容；已手動編輯過時需 overwrite */
export function saveGeneratedTalk(args: {
  paths: StoragePaths;
  config: Config;
  id: string;
  prepared: PreparedTalk;
  content: string;
  overwrite?: boolean;
  now?: number;
}): TalkRecord {
  const existing = getTalk(args.paths, args.id);
  if (!existing) throw new Error(`找不到小交流 ${args.id}`);
  if (existing.edited && !args.overwrite) throw new TalkConflictError(`${args.id} 已被手動編輯過，需帶 overwrite=true 才會覆蓋`);
  const p = args.prepared;
  return writeTalk(args.paths, {
    ...existing,
    dates: p.dates,
    prompt: p.prompt_name,
    prompt_hash: p.prompt_hash,
    sources: p.sources,
    sources_version: p.sources_version,
    stats: p.stats as unknown as Record<string, unknown>,
    generated_at: toIsoInTz(args.now ?? Date.now(), args.config.time.timezone),
    edited: false,
    body: args.content.trim(),
  });
}


/** 清單上的狀態：沒有內容、已產生、已編輯、來源有變動 */
export function talkStatus(t: Pick<TalkRecord, 'body' | 'edited'>, stale: boolean): 'none' | 'generated' | 'edited' | 'stale' {
  if (!t.body.trim()) return 'none';
  return stale ? 'stale' : t.edited ? 'edited' : 'generated';
}

/** 使用者在 UI 修改標題、日期或內容；內容有變才標為已編輯 */
export function applyTalkEdit<T extends TalkRecord>(t: T, edit: { content?: string; title?: string; dates?: readonly string[] }): T {
  const contentChanged = edit.content !== undefined && edit.content !== t.body;
  return {
    ...t,
    title: edit.title !== undefined ? edit.title.trim() : t.title,
    dates: edit.dates !== undefined ? normalizeDates(edit.dates) : t.dates,
    body: edit.content ?? t.body,
    edited: t.edited || contentChanged,
  };
}

/** 垃圾桶檔名（`<時間>__talk__<id>.md`）還原成原本的 id */
export function talkIdFromTrash(trashPath: string): string {
  return basename(trashPath).replace(/^.*__talk__/, '').replace(/\.md$/, '');
}
