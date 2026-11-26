/**
 * 規格 5.2、5.3、7.2、7.3、9.8、15：每日摘要的範本組裝、寫入、補寫輸入精簡、前次未完成項目、敏感資訊遮蔽。
 */
import { z } from 'zod';
import { addDays, localDate } from '../capture/tz.js';
import { renderTemplate, loadPrompt, splitRef } from '../prompt/index.js';
import { parseFrontmatter } from '../storage/frontmatter.js';
import { shortHash } from '../storage/fsutil.js';
import { formatDraft, formatItems } from '../prompt/format.js';
import type { Config } from '../schema/config.js';
import { Item, OPEN_STATUSES, type Task } from '../schema/task.js';
import { withLock } from '../storage/fsutil.js';
import type { StoragePaths } from '../storage/paths.js';
import { listTasks, readTask, taskLockKey, writeTask, type TaskRecord } from '../storage/tasks.js';
import type { TranscriptEvent } from '../transcript/index.js';
import { SUMMARY_RULES_JSON, SUMMARY_RULES_MCP } from '../../templates/prompts.js';
import { taskId } from '../schema/task.js';
import { assignProject } from '../sync/projects.js';
import { rebalanceDay, type DayHoursSummary } from '../sync/day-hours.js';

// ───────────── 敏感資訊遮蔽（規格 15）

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, label: '私鑰' },
  { re: /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token|client[_-]?secret)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s;,'"]+)/gi, label: '密碼或金鑰' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS 金鑰' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, label: 'GitHub token' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, label: 'API 金鑰' },
  { re: /\b(?:Bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/g, label: 'Bearer token' },
];

export function maskSecrets(text: string): { text: string; found: string[] } {
  const found = new Set<string>();
  let out = text;
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, (m: string, key?: string) => {
      found.add(label);
      if (label === '密碼或金鑰' && key) return `${key}=[已遮蔽]`;
      return '[已遮蔽]';
    });
  }
  return { text: out, found: [...found] };
}

// ───────────── 前次未完成項目（規格 7.3）

export function carryOver(
  paths: StoragePaths,
  ticket: string,
  beforeDate: string,
  lookbackDays = 180,
): { from_task_id: string | null; items: Item[] } {
  const tasks = listTasks(paths, addDays(beforeDate, -lookbackDays), addDays(beforeDate, -1))
    .filter((t) => t.ticket === ticket && t.items.length)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.summary_updated_at ?? '').localeCompare(a.summary_updated_at ?? ''));
  const t = tasks[0];
  if (!t) return { from_task_id: null, items: [] };
  return { from_task_id: t.id, items: t.items.filter((i) => OPEN_STATUSES.includes(i.status)) };
}

// ───────────── 摘要範本（規格 7.2.1、9.8）

export interface SummaryGuide {
  guide: string;
  prompt_name: string;
  prompt_hash: string;
  previous_items: Item[];
}

export function buildSummaryGuide(args: {
  paths: StoragePaths;
  config: Config;
  task: Task;
  mode: 'mcp' | 'json';
  transcript?: string;
  prompt?: string;
  /** 試跑尚未儲存的範本：以此內容（含前段 YAML）取代範本檔 */
  templateText?: string;
  today: string;
}): SummaryGuide {
  const { paths, config, task } = args;
  const ref = summaryPromptRef(config, args.prompt);
  const prompt =
    args.templateText !== undefined
      ? { ref, type: splitRef(ref).type, body: parseFrontmatter(args.templateText).body.trim(), hash: shortHash(args.templateText) }
      : loadPrompt(paths, ref);
  if (prompt.type !== 'summary') throw new Error(`範本 ${prompt.ref} 不是摘要類型`);
  const prev = task.ticket ? carryOver(paths, task.ticket, task.date) : { items: [] };
  const vars = {
    today: args.today,
    user_name: config.user_name || '使用者',
    draft: [formatDraft(task), dayHoursHint(paths, config, task)].filter(Boolean).join('\n'),
    previous_items: prev.items.length ? formatItems(prev.items) : '（無）',
    transcript: args.transcript ?? '請依目前對話內容撰寫（你已在對話中，不需重送對話紀錄）。',
  };
  const rules = renderTemplate(args.mode === 'mcp' ? SUMMARY_RULES_MCP : SUMMARY_RULES_JSON, {
    session_id: task.session_id,
    date: task.date,
    prompt_name: prompt.ref,
    prompt_hash: prompt.hash,
  });
  return {
    guide: `${renderTemplate(prompt.body, vars)}\n${rules}`,
    prompt_name: prompt.ref,
    prompt_hash: prompt.hash,
    previous_items: prev.items,
  };
}

/** 草稿附上當天其他任務已記錄的時數與剩餘工時，讓 AI 粗估時參考；手動任務與未設定每日工時時不附 */
export function dayHoursHint(paths: StoragePaths, config: Config, task: Pick<Task, 'date' | 'session_id' | 'manual'>): string {
  const daily = config.time.daily_hours;
  if (daily <= 0 || task.manual) return '';
  const others = listTasks(paths, task.date, task.date).filter((t) => t.session_id !== task.session_id);
  const used = Math.round(others.reduce((s, t) => s + t.hours, 0) * 100) / 100;
  const left = Math.max(0, Math.round((daily - used) * 100) / 100);
  return `- 每日工時：${daily}h；當天其他 ${others.length} 個任務已記 ${used}h，剩餘約 ${left}h（粗估時數請盡量讓當天加總不超過每日工時；超過時系統會依比例縮減 AI 粗估的時數）`;
}

/** 摘要範本的參照：未指定時用設定的預設範本；只寫名稱時補上 summary/ */
export function summaryPromptRef(config: Config, prompt?: string): string {
  const ref = prompt ?? config.summary.default_prompt;
  return ref.includes('/') ? ref : `summary/${ref}`;
}

/**
 * 從摘要範本取出「## 撰寫規則」段落（到下一個二級標題為止），放進 worklog_save_summary 的工具說明，
 * 讓 Claude 不必先呼叫 worklog_get_summary_guide 也能依範本撰寫。範本沒有這一段時回傳 null。
 */
export function summaryWritingRules(paths: StoragePaths, config: Config): { rules: string | null; prompt_name: string; prompt_hash: string } {
  const prompt = loadPrompt(paths, summaryPromptRef(config));
  const m = /^##\s*撰寫規則[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(prompt.body);
  const rules = m?.[1]?.trim() || null;
  return { rules, prompt_name: prompt.ref, prompt_hash: prompt.hash };
}

/** 前次未完成、但沒有出現在這次子項中的項目（以去除空白後的文字比對） */
export function missingCarryOver(previous: readonly Item[], items: readonly { text: string }[]): Item[] {
  const norm = (t: string) => t.replace(/\s+/g, '');
  const have = new Set(items.map((i) => norm(i.text)));
  return previous.filter((p) => !have.has(norm(p.text)));
}

// ───────────── 寫入摘要（規格 7.2）

export const SummaryInput = z.object({
  title: z.string().trim().max(200).optional(),
  items: z.array(Item).min(1).max(30),
  notes: z.string().optional(),
  project: z.string().optional(),
  ticket: z.string().optional(),
  hours_estimate: z.number().min(0).max(24).optional(),
  prompt_name: z.string().optional(),
  prompt_hash: z.string().optional(),
});
export type SummaryInput = z.infer<typeof SummaryInput>;

export interface SaveSummaryResult {
  task: TaskRecord;
  warnings: string[];
  /** 寫入後當天的時數加總 */
  day: DayHoursSummary;
}

/** 寫入摘要欄位：items 整批取代；共用欄位只在未鎖定時套用；疑似密鑰會被遮蔽並警告 */
export async function applySummary(paths: StoragePaths, config: Config, taskPath: string, input: SummaryInput): Promise<SaveSummaryResult> {
  const warnings: string[] = [];
  const mask = (s: string) => {
    const r = maskSecrets(s);
    for (const f of r.found) warnings.push(`偵測到疑似${f}，已遮蔽`);
    return r.text;
  };
  const first = readTask(taskPath);
  if (!first) throw new Error(`讀不到任務檔：${taskPath}`);
  const task = await withLock(taskLockKey(paths, first.date, first.session_id), () => {
    const t = readTask(taskPath) ?? first;
    const next: Task = { ...t };
    next.items = input.items.map((i) => ({ ...i, text: mask(i.text), note: i.note ? mask(i.note) : undefined }));
    if (input.title) {
      next.title = mask(input.title);
      next.title_source = 'summary';
    }
    if (input.notes !== undefined) next.body = mask(input.notes);
    const locked = new Set(t.locked_fields);
    if (input.project && !locked.has('project')) assignProject(next, input.project, config);
    if (input.ticket && !locked.has('ticket')) next.ticket = input.ticket;
    if (input.hours_estimate !== undefined && !t.hours_overridden && t.hours_source !== 'user') {
      next.hours = Math.round(input.hours_estimate / config.time.rounding) * config.time.rounding;
      next.hours_estimate = next.hours;
      next.hours_source = 'ai';
    }
    next.summary_status = 'done';
    next.summary_updated_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    next.summary_prompt = input.prompt_hash ? input.prompt_name : 'none';
    next.summary_prompt_hash = input.prompt_hash;
    next.id = taskId(next.date, next.ticket, next.session_id);
    return writeTask(paths, next, t.path);
  });
  // 依每日工時調整當天 AI 粗估的時數（可能包含剛寫入的這個任務）
  const { written, summary: day } = await rebalanceDay(paths, config, task.date);
  const self = written.find((w) => w.session_id === task.session_id) ?? task;
  if (self.hours_source === 'ai' && self.hours_estimate !== undefined && self.hours < self.hours_estimate) {
    warnings.push(
      `當天時數加總超過每日工時 ${day.daily_hours}h，本任務由 AI 粗估 ${self.hours_estimate}h 依比例調整為 ${self.hours}h（共調整 ${day.adjusted} 個任務）`,
    );
  }
  return { task: self, warnings: [...new Set(warnings)], day };
}

// ───────────── 補寫用的對話精簡（規格 5.3）

const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'description', 'url'];

function toolSummary(e: TranscriptEvent): string {
  const input = (e.toolInput ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of PATH_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v) parts.push(v.length > 160 ? `${v.slice(0, 160)}…` : v);
  }
  return `🔧 ${e.toolName ?? 'tool'}${parts.length ? `：${parts.join('｜')}` : ''}`;
}

/** 保留使用者訊息、Claude 文字回應、工具名稱與檔案路徑；省略工具輸出。超過上限時保留開頭與最近的內容 */
export function condenseTranscript(
  events: readonly TranscriptEvent[],
  maxChars: number,
  only?: { date: string; timezone: string },
): string {
  const lines: string[] = [];
  for (const e of events) {
    if (e.copied || e.sidechain) continue;
    if (only && localDate(e.ts, only.timezone) !== only.date) continue;
    if (e.role === 'user' && e.text) lines.push(`👤 使用者：${e.text.trim()}`);
    else if (e.role === 'assistant' && e.text) lines.push(`🤖 Claude：${e.text.trim()}`);
    else if (e.role === 'tool_use') lines.push(toolSummary(e));
  }
  const all = maskSecrets(lines.join('\n\n')).text;
  if (all.length <= maxChars) return all;
  const head = all.slice(0, Math.floor(maxChars * 0.3));
  const tail = all.slice(all.length - Math.floor(maxChars * 0.7));
  return `${head}\n\n…（中間省略 ${all.length - head.length - tail.length} 字）…\n\n${tail}`;
}
