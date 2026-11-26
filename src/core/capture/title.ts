/**
 * 規格 6.4：標題候選。
 */
import type { TranscriptEvent } from '../transcript/index.js';
import { isJiraTool } from './ticket.js';

export type TitleSource = 'summary' | 'jira' | 'custom_title' | 'first_user_message';

export interface TitleCandidate {
  title: string;
  source: TitleSource;
}

const FIRST_MESSAGE_CHARS = 60;

/** 在 Jira 工具回傳內容中找 summary 欄位 */
export function findJiraSummary(text: string): string | undefined {
  try {
    const found = searchSummary(JSON.parse(text), 0);
    if (found) return found;
  } catch {
    // 非 JSON，改用正規表示式
  }
  const m = /"summary"\s*:\s*"((?:[^"\\]|\\.){1,300})"/.exec(text);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return m[1];
    }
  }
  return undefined;
}

function searchSummary(v: unknown, depth: number): string | undefined {
  if (depth > 6 || v === null || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = searchSummary(x, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.summary === 'string' && o.summary.trim()) return o.summary.trim();
  // MCP 回傳常把 JSON 包在 text 欄位
  if (typeof o.text === 'string') {
    const r = findJiraSummary(o.text);
    if (r) return r;
  }
  for (const k of Object.keys(o)) {
    const r = searchSummary(o[k], depth + 1);
    if (r) return r;
  }
  return undefined;
}

function firstChars(text: string, n: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const chars = [...oneLine];
  return chars.length > n ? chars.slice(0, n).join('') + '…' : oneLine;
}

/**
 * 依序：摘要標題 → Jira 工具回傳的 summary（優先選與單號相符者）→
 * Claude Desktop 的對話標題 → 第一則使用者訊息前 60 字。
 *
 * 規格只列三項；Desktop 對話標題（custom-title）是紀錄檔中現成的語意標題，
 * 品質優於截斷的第一則訊息，故插在第三順位。
 */
export function pickTitle(args: {
  events: readonly TranscriptEvent[];
  ticket: string | null;
  summaryTitle?: string;
  customTitle?: string;
}): TitleCandidate | null {
  if (args.summaryTitle?.trim()) return { title: args.summaryTitle.trim(), source: 'summary' };

  const jiraUses = new Map<string, string>(); // tool_use id → input JSON
  let anyJira: string | undefined;
  let matchJira: string | undefined;
  for (const e of args.events) {
    if (e.role === 'tool_use' && isJiraTool(e.toolName) && e.toolUseId) {
      jiraUses.set(e.toolUseId, JSON.stringify(e.toolInput ?? ''));
    } else if (e.role === 'tool_result' && e.toolUseId && jiraUses.has(e.toolUseId) && e.text) {
      const s = findJiraSummary(e.text);
      if (!s) continue;
      anyJira ??= s;
      if (!matchJira && args.ticket && jiraUses.get(e.toolUseId)!.includes(args.ticket)) matchJira = s;
    }
  }
  const jira = matchJira ?? anyJira;
  if (jira) return { title: jira, source: 'jira' };

  if (args.customTitle?.trim()) return { title: args.customTitle.trim(), source: 'custom_title' };

  const first = args.events.find((e) => e.role === 'user' && !e.sidechain && e.text);
  if (first?.text) return { title: firstChars(first.text, FIRST_MESSAGE_CHARS), source: 'first_user_message' };
  return null;
}
