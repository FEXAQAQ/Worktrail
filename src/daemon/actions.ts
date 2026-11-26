/**
 * 以 `claude -p` 執行的工作：補寫摘要（規格 5.3）、產生報告（規格 9.6）、範本試跑（規格 11.4）。
 */
import { readFileSync } from 'node:fs';
import { ClaudeCliError, extractJson, findClaude, runClaudePrint } from '../core/claude-cli/index.js';
import { localDate } from '../core/capture/tz.js';
import type { Period } from '../core/period/index.js';
import { prepareReport, saveReport } from '../core/report/prepare.js';
import type { Config } from '../core/schema/config.js';
import type { ReportType } from '../core/schema/report.js';
import type { StoragePaths } from '../core/storage/paths.js';
import type { TaskRecord } from '../core/storage/tasks.js';
import { applySummary, buildSummaryGuide, condenseTranscript, SummaryInput } from '../core/summary/index.js';
import { buildJiraFetchPrompt, formatJiraContent, jiraAllowedTools, JiraFetchResult } from '../core/summary/jira.js';
import { findTranscriptPath } from '../core/sync/locate.js';
import { prepareTalk, saveGeneratedTalk } from '../core/talk/index.js';
import {
  buildTicketInfoPrompt,
  parseTicketInfoOutput,
  ticketInfoAllowedTools,
  updateTicketCache,
  type TicketInfo,
} from '../core/ticket-info/index.js';
import { parseTranscript } from '../core/transcript/index.js';
import type { JobContext } from './jobs.js';

async function claudePath(config: Config): Promise<string> {
  const p = await findClaude(config.claude_cli.path);
  if (!p) throw new ClaudeCliError('找不到 claude CLI：請在設定 → 整合中指定路徑');
  return p;
}

/** 組出補寫摘要用的 prompt（試跑也用） */
export function summaryPromptFor(
  paths: StoragePaths,
  config: Config,
  task: TaskRecord,
  promptRef?: string,
  templateText?: string,
): { prompt: string; prompt_name: string; prompt_hash: string } {
  const transcriptPath = findTranscriptPath(paths, task.session_id, task.repo);
  if (!transcriptPath) throw new Error('找不到這個任務的對話紀錄檔，無法補寫摘要');
  const parsed = parseTranscript(readFileSync(transcriptPath, 'utf8'));
  const transcript = condenseTranscript(parsed.events, config.summary.max_input_chars, {
    date: task.date,
    timezone: config.time.timezone,
  });
  const g = buildSummaryGuide({
    paths,
    config,
    task,
    mode: 'json',
    transcript,
    prompt: promptRef,
    templateText,
    today: localDate(Date.now(), config.time.timezone),
  });
  return { prompt: g.guide, prompt_name: g.prompt_name, prompt_hash: g.prompt_hash };
}

export async function summarizeTask(
  paths: StoragePaths,
  config: Config,
  task: TaskRecord,
  ctx: JobContext,
): Promise<{ task_id: string; items: number; warnings: string[] }> {
  ctx.progress('整理對話紀錄…');
  const { prompt, prompt_name, prompt_hash } = summaryPromptFor(paths, config, task);
  ctx.progress('Claude 撰寫中…');
  const out = await runClaudePrint({
    claudePath: await claudePath(config),
    prompt,
    cwd: paths.claudeRuns,
    signal: ctx.signal,
    onProgress: (n) => ctx.progress(`Claude 撰寫中…（${n} 字）`),
  });
  let parsed: unknown;
  try {
    parsed = extractJson(out);
  } catch (e) {
    throw new Error(`Claude 的輸出不是有效的 JSON，已保留草稿：${(e as Error).message}`);
  }
  const input = SummaryInput.safeParse({ ...(parsed as object), prompt_name, prompt_hash });
  if (!input.success) {
    throw new Error(`摘要格式不正確，已保留草稿：${input.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}`);
  }
  const r = await applySummary(paths, config, task.path, input.data);
  return { task_id: r.task.id, items: r.task.items.length, warnings: r.warnings };
}

/** 手動任務「從 Jira 整理」：claude -p 經 Jira MCP 讀留言 → 依內文日期過濾 → 套摘要範本產生子項 */
export async function jiraSummarizeTask(
  paths: StoragePaths,
  config: Config,
  task: TaskRecord,
  ctx: JobContext,
): Promise<{ task_id: string; items: number; comments: number; warnings: string[] }> {
  if (!task.ticket) throw new Error('這個任務沒有填單號');
  const claude = await claudePath(config);
  const server = config.claude_cli.jira_mcp_server || 'atlassian-rovo-mcp';
  ctx.progress(`讀取 ${task.ticket} 的留言…`);
  const raw = await runClaudePrint({
    claudePath: claude,
    prompt: buildJiraFetchPrompt(task.ticket, server),
    cwd: paths.claudeRuns,
    signal: ctx.signal,
    timeoutMs: 5 * 60_000,
    extraArgs: ['--allowedTools', ...jiraAllowedTools(server)],
  });
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    throw new Error(`無法讀取 Jira 留言（請確認 claude CLI 能使用 ${server}）：${raw.slice(0, 300)}`);
  }
  if (json && typeof json === 'object' && 'error' in json) throw new Error(`讀取 Jira 失敗：${String((json as { error: unknown }).error)}`);
  const fetched = JiraFetchResult.parse(json);
  const content = formatJiraContent(task.ticket, fetched, task.date);
  if (!content) {
    throw new Error(`${task.ticket} 共 ${fetched.comments.length} 則留言，沒有內文標示 ${task.date.replaceAll('-', '/')} 的留言`);
  }
  ctx.progress(`整理 ${content.count} 段留言…`);
  const g = buildSummaryGuide({
    paths,
    config,
    task,
    mode: 'json',
    prompt: config.summary.jira_prompt,
    transcript: content.text,
    today: localDate(Date.now(), config.time.timezone),
  });
  const out = await runClaudePrint({
    claudePath: claude,
    prompt: g.guide,
    cwd: paths.claudeRuns,
    signal: ctx.signal,
    onProgress: (n) => ctx.progress(`Claude 撰寫中…（${n} 字）`),
  });
  let parsed: unknown;
  try {
    parsed = extractJson(out);
  } catch (e) {
    throw new Error(`Claude 的輸出不是有效的 JSON：${(e as Error).message}`);
  }
  const input = SummaryInput.safeParse({ ...(parsed as object), prompt_name: g.prompt_name, prompt_hash: g.prompt_hash });
  if (!input.success) throw new Error(`摘要格式不正確：${input.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}`);
  // 手動任務的標題是使用者填的；只有標題就是單號本身時，才換成 Jira 標題
  const keepTitle = task.title.trim().toUpperCase() !== task.ticket;
  const data = { ...input.data, title: keepTitle ? undefined : fetched.summary || input.data.title };
  const r = await applySummary(paths, config, task.path, data);
  return { task_id: r.task.id, items: r.task.items.length, comments: content.count, warnings: r.warnings };
}

export async function generateReport(
  paths: StoragePaths,
  config: Config,
  args: { type: ReportType; period: Period; prompt?: string; overwrite?: boolean },
  ctx: JobContext,
): Promise<{ report_id: string; warnings: string[] }> {
  ctx.progress('準備資料…');
  const today = localDate(Date.now(), config.time.timezone);
  const p = prepareReport({ paths, config, type: args.type, period: args.period, prompt: args.prompt, today });
  ctx.progress('Claude 撰寫中…');
  const out = await runClaudePrint({
    claudePath: await claudePath(config),
    prompt: `${p.rendered_prompt}\n\n---\n只輸出報告的 Markdown 內文，不要加上前言、說明或程式碼框。`,
    cwd: paths.claudeRuns,
    signal: ctx.signal,
    onProgress: (n) => ctx.progress(`Claude 撰寫中…（${n} 字）`),
  });
  const content = out.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/m, '$1');
  const r = saveReport({
    paths,
    config,
    type: args.type,
    period: p.period,
    prompt_name: p.prompt_name,
    prompt_hash: p.prompt_hash,
    sources: p.sources,
    stats: p.stats,
    content,
    overwrite: args.overwrite,
    sources_version: p.sources_version,
  });
  return { report_id: r.id, warnings: p.warnings };
}

/** 小交流：依勾選的日期產生簡短重點 */
export async function generateTalk(
  paths: StoragePaths,
  config: Config,
  args: { id: string; dates: string[]; prompt?: string; overwrite?: boolean },
  ctx: JobContext,
): Promise<{ talk_id: string; warnings: string[] }> {
  ctx.progress('準備資料…');
  const today = localDate(Date.now(), config.time.timezone);
  const p = prepareTalk({ paths, config, dates: args.dates, prompt: args.prompt, excludeId: args.id, today });
  ctx.progress('Claude 撰寫中…');
  const out = await runClaudePrint({
    claudePath: await claudePath(config),
    prompt: `${p.rendered_prompt}\n\n---\n只輸出重點的 Markdown 內文，不要加上前言、說明或程式碼框。`,
    cwd: paths.claudeRuns,
    signal: ctx.signal,
    onProgress: (n) => ctx.progress(`Claude 撰寫中…（${n} 字）`),
  });
  const content = out.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/m, '$1');
  const t = saveGeneratedTalk({ paths, config, id: args.id, prepared: p, content, overwrite: args.overwrite });
  return { talk_id: t.id, warnings: p.warnings };
}

/** 一次 claude -p 查詢的單號數上限 */
const TICKET_BATCH = 15;

/** 透過 Jira MCP 查詢單號的父卡片並寫入快取；回傳這次查詢的結果 */
export async function refreshTicketInfo(
  paths: StoragePaths,
  config: Config,
  tickets: readonly string[],
  ctx: JobContext,
): Promise<{ fetched: TicketInfo[]; errors: string[] }> {
  if (!tickets.length) return { fetched: [], errors: [] };
  const claude = await claudePath(config);
  const server = config.claude_cli.jira_mcp_server || 'atlassian-rovo-mcp';
  const fetched: TicketInfo[] = [];
  const errors: string[] = [];
  for (let i = 0; i < tickets.length; i += TICKET_BATCH) {
    if (ctx.signal.aborted) break;
    const batch = tickets.slice(i, i + TICKET_BATCH);
    ctx.progress(`查詢父卡片 ${Math.min(i + batch.length, tickets.length)}/${tickets.length}…`);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    let infos: TicketInfo[];
    try {
      const raw = await runClaudePrint({
        claudePath: claude,
        prompt: buildTicketInfoPrompt(batch, server),
        cwd: paths.claudeRuns,
        signal: ctx.signal,
        timeoutMs: 5 * 60_000,
        extraArgs: ['--allowedTools', ...ticketInfoAllowedTools(server)],
      });
      const json = extractJson(raw);
      if (json && typeof json === 'object' && 'error' in json && !('tickets' in json)) {
        throw new Error(String((json as { error: unknown }).error));
      }
      infos = parseTicketInfoOutput(json, batch, now);
    } catch (e) {
      if (ctx.signal.aborted) break;
      const msg = (e as Error).message.slice(0, 300);
      errors.push(`${batch.join(', ')}：${msg}`);
      infos = batch.map((key) => ({ key, summary: '', type: '', ancestors: [], fetched_at: now, error: msg }));
    }
    await updateTicketCache(paths, infos);
    fetched.push(...infos);
  }
  return { fetched, errors };
}

/** 試跑：以 prompt 產生輸出但不存檔 */
export async function previewOutput(config: Config, paths: StoragePaths, prompt: string, ctx: JobContext): Promise<{ output: string }> {
  ctx.progress('Claude 撰寫中…');
  const output = await runClaudePrint({
    claudePath: await claudePath(config),
    prompt,
    cwd: paths.claudeRuns,
    signal: ctx.signal,
    onProgress: (n) => ctx.progress(`Claude 撰寫中…（${n} 字）`),
  });
  return { output };
}
