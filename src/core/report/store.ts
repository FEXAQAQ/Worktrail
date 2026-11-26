/**
 * 規格 4.4：週報與績效報告檔。
 */
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ReportFrontmatter, type Report, type ReportType } from '../schema/report.js';
import { parseFrontmatter, stringifyFrontmatter } from '../storage/frontmatter.js';
import { contentVersion, ensureDir, readText, writeFileAtomic } from '../storage/fsutil.js';
import type { StoragePaths } from '../storage/paths.js';

export interface ReportRecord extends Report {
  /** 期間標籤（檔名） */
  id: string;
  path: string;
  version: string;
  /** 產生時來源的雜湊，用於判斷是否過期（規格未列，額外欄位） */
  sources_version?: string;
}

const ORDER = ['schema', 'type', 'period_start', 'period_end', 'prompt', 'prompt_hash', 'sources', 'sources_version', 'stats', 'generated_at', 'edited', 'stale'];

export function reportPath(paths: StoragePaths, type: ReportType, id: string): string {
  return join(paths.reportDir(type), `${id}.md`);
}

export function readReport(path: string): ReportRecord | null {
  const text = readText(path);
  if (text === null) return null;
  const { data, body } = parseFrontmatter(text);
  const r = ReportFrontmatter.safeParse(data);
  if (!r.success) return null;
  return {
    ...r.data,
    body,
    id: basename(path, '.md'),
    path,
    version: contentVersion(text),
    sources_version: typeof data.sources_version === 'string' ? data.sources_version : undefined,
  };
}

export function getReport(paths: StoragePaths, type: ReportType, id: string): ReportRecord | null {
  return readReport(reportPath(paths, type, id));
}

export function writeReport(paths: StoragePaths, r: Omit<ReportRecord, 'path' | 'version'>): ReportRecord {
  const { body, id, ...fm } = r;
  const ordered: Record<string, unknown> = {};
  for (const k of ORDER) if (k in fm) ordered[k] = (fm as Record<string, unknown>)[k];
  const text = stringifyFrontmatter(ordered, body);
  const path = reportPath(paths, r.type, id);
  writeFileAtomic(path, text);
  return { ...r, path, version: contentVersion(text) };
}

export function listReports(paths: StoragePaths, type: ReportType): ReportRecord[] {
  const dir = paths.reportDir(type);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => readReport(join(dir, f)))
    .filter((r): r is ReportRecord => !!r)
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}

export function trashReport(paths: StoragePaths, r: ReportRecord): string {
  ensureDir(paths.trash);
  const dest = join(paths.trash, `${Date.now()}__${r.type}__${basename(r.path)}`);
  renameSync(r.path, dest);
  return dest;
}
