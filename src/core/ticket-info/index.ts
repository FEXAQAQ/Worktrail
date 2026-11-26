/**
 * 單號資訊快取：Jira 單號的標題、類型與上層卡片（父卡片、Epic…），供專案分類使用。
 *
 * - 由常駐服務以 `claude -p` 透過使用者已連線的 Jira MCP 查詢（Worktrail 不直接呼叫 Jira API，規格 1.3）。
 * - hook 擷取時只讀快取，不連線，不受 2 秒上限影響。
 * - 快取在 `<storage>/.worktrail/ticket-info.json`。
 */
import { join } from 'node:path';
import { z } from 'zod';
import { readText, withLock, writeFileAtomic } from '../storage/fsutil.js';
import type { StoragePaths } from '../storage/paths.js';

export const TicketRef = z.object({
  key: z.string().min(1),
  summary: z.string().default(''),
  type: z.string().default(''),
});
export type TicketRef = z.infer<typeof TicketRef>;

export const TicketInfo = TicketRef.extend({
  /** 上層卡片，由近到遠（父卡片在前，最上層例如 Epic 在後） */
  ancestors: z.array(TicketRef).default([]),
  fetched_at: z.string(),
  /** 最近一次查詢失敗的原因（稍後重試）；ancestors 保留先前成功查到的資料 */
  error: z.string().optional(),
});
export type TicketInfo = z.infer<typeof TicketInfo>;

const CacheFile = z.object({
  schema: z.literal(1).default(1),
  tickets: z.record(z.string(), TicketInfo).default({}),
});
export type TicketCache = Record<string, TicketInfo>;

export const ticketCachePath = (paths: StoragePaths) => join(paths.internal, 'ticket-info.json');

/** 讀取快取；檔案不存在或損壞時回傳空物件 */
export function readTicketCache(paths: StoragePaths): TicketCache {
  const text = readText(ticketCachePath(paths));
  if (!text) return {};
  try {
    const r = CacheFile.safeParse(JSON.parse(text));
    return r.success ? r.data.tickets : {};
  } catch {
    return {};
  }
}

export async function updateTicketCache(paths: StoragePaths, entries: readonly TicketInfo[]): Promise<TicketCache> {
  const file = ticketCachePath(paths);
  return withLock(file, () => {
    const tickets = { ...readTicketCache(paths) };
    for (const e of entries) {
      // 查詢失敗時保留先前成功的上層資料，只記錄錯誤
      const prev = tickets[e.key];
      tickets[e.key] = e.error && prev && !prev.error ? { ...prev, error: e.error, fetched_at: e.fetched_at } : e;
    }
    writeFileAtomic(file, `${JSON.stringify({ schema: 1, tickets }, null, 2)}\n`);
    return tickets;
  });
}

/** 單號本身與其上層卡片的單號（比對專案規則用） */
export function lineageKeys(ticket: string, info: TicketInfo | undefined): string[] {
  return [ticket, ...(info?.ancestors ?? []).map((a) => a.key)];
}

const DAY = 24 * 60 * 60_000;

/** 需要（重新）查詢的單號：沒有快取、超過 maxAgeDays、或上次失敗超過 retryHours */
export function ticketsNeedingRefresh(
  tickets: Iterable<string>,
  cache: TicketCache,
  now: number,
  opts: { maxAgeDays?: number; retryHours?: number } = {},
): string[] {
  const maxAge = (opts.maxAgeDays ?? 7) * DAY;
  const retry = (opts.retryHours ?? 6) * 60 * 60_000;
  const out = new Set<string>();
  for (const t of tickets) {
    const key = t.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) continue;
    const c = cache[key];
    const age = c ? now - Date.parse(c.fetched_at) : Infinity;
    if (!c || !(age >= 0) || age > (c.error ? retry : maxAge)) out.add(key);
  }
  return [...out].sort();
}

/** `claude -p` 允許使用的 Jira MCP 工具（唯讀） */
export function ticketInfoAllowedTools(server: string): string[] {
  return ['getAccessibleAtlassianResources', 'getJiraIssue'].map((t) => `mcp__${server}__${t}`);
}

/** 上層卡片最多查幾層（子任務 → Story → Epic → 更上層） */
export const MAX_ANCESTOR_DEPTH = 4;

export function buildTicketInfoPrompt(keys: readonly string[], server: string): string {
  return `請用 Jira MCP（${server}）查詢下列 Jira 單號的標題、類型與上層卡片，不要修改任何 Jira 資料。

單號：${keys.join(', ')}

步驟：
1. 呼叫 getAccessibleAtlassianResources 取得 cloudId（選有 read:jira-work 權限的站台）。
2. 對每個單號呼叫 getJiraIssue：fields=["summary","issuetype","parent"]。
3. 若有 parent，再以同樣方式查詢 parent，一路往上，直到沒有 parent 或已往上 ${MAX_ANCESTOR_DEPTH} 層。查過的單號不必重查。

只輸出一個 JSON 物件，不要有其他文字或 Markdown 程式碼框：
{"tickets": [{"key": "單號", "summary": "標題", "type": "類型名稱（例如 Story、Epic、Sub-task）", "ancestors": [{"key": "父卡片單號", "summary": "標題", "type": "類型"}, {"key": "父卡片的父卡片", "summary": "…", "type": "…"}]}], "errors": [{"key": "單號", "error": "原因"}]}
ancestors 由近到遠排列；沒有上層卡片時為空陣列。查不到的單號放在 errors。`;
}

const Output = z.object({
  tickets: z.array(TicketRef.extend({ ancestors: z.array(TicketRef).default([]) })).default([]),
  errors: z.array(z.object({ key: z.string(), error: z.string().default('查詢失敗') })).default([]),
});

/** 解析 claude -p 的輸出；沒有出現在結果中的單號記為失敗 */
export function parseTicketInfoOutput(json: unknown, requested: readonly string[], fetchedAt: string): TicketInfo[] {
  const o = Output.parse(json);
  const norm = (k: string) => k.trim().toUpperCase();
  const want = new Set(requested.map(norm));
  const out = new Map<string, TicketInfo>();
  for (const t of o.tickets) {
    const key = norm(t.key);
    if (!want.has(key)) continue;
    const ancestors = t.ancestors
      .map((a) => ({ ...a, key: norm(a.key) }))
      .filter((a) => a.key !== key)
      .slice(0, MAX_ANCESTOR_DEPTH);
    out.set(key, { key, summary: t.summary, type: t.type, ancestors, fetched_at: fetchedAt });
  }
  for (const e of o.errors) {
    const key = norm(e.key);
    if (want.has(key) && !out.has(key)) out.set(key, { key, summary: '', type: '', ancestors: [], fetched_at: fetchedAt, error: e.error });
  }
  for (const key of want) {
    if (!out.has(key)) out.set(key, { key, summary: '', type: '', ancestors: [], fetched_at: fetchedAt, error: '查詢結果中沒有這個單號' });
  }
  return [...out.values()];
}
