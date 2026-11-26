/**
 * 規格 7：MCP 工具的實作（與 SDK 分離，方便測試）。
 */
import { z } from 'zod';
import { localDate } from '../core/capture/tz.js';
import { parsePeriodArg, type PeriodSpec } from '../core/period/index.js';
import { prepareReport, saveReport } from '../core/report/prepare.js';
import type { Config } from '../core/schema/config.js';
import { IsoDate, ItemStatus, SummaryStatus } from '../core/schema/task.js';
import { ReportType } from '../core/schema/report.js';
import { loadConfig } from '../core/storage/config-store.js';
import type { StoragePaths } from '../core/storage/paths.js';
import { sessionState, updateState } from '../core/storage/state.js';
import { findTaskById, findTaskFile, listTasks, readTask, type TaskRecord } from '../core/storage/tasks.js';
import { applySummary, buildSummaryGuide, carryOver, missingCarryOver, SummaryInput, summaryWritingRules } from '../core/summary/index.js';
import { captureSession } from '../core/sync/capture-session.js';
import { measureProgress } from '../core/sync/guard.js';
import { findTranscriptPath, resolveSessionId } from '../core/sync/locate.js';
import { readDaemonInfo, uiUrl } from '../daemon/client.js';

export interface ToolContext {
  paths: StoragePaths;
  /** MCP 程序的工作目錄（= Claude Code 的專案目錄） */
  cwd: string;
  now?: () => number;
  /** 開啟 UI（測試替換，避免真的啟動服務與視窗）；回傳 UI 網址 */
  openUi?: (port: number) => Promise<string>;
}

export class ToolError extends Error {}

function ctxConfig(ctx: ToolContext): Config {
  return loadConfig(ctx.paths).config;
}

const today = (ctx: ToolContext, config: Config) => localDate(ctx.now?.() ?? Date.now(), config.time.timezone);

function currentUiUrl(config: Config): string {
  return uiUrl(readDaemonInfo()?.port ?? config.ui.port);
}

function taskUrl(config: Config, id: string): string {
  return `${currentUiUrl(config)}/log?task=${encodeURIComponent(id)}`;
}

/** 精簡的任務輸出（給 Claude 看） */
function taskView(t: TaskRecord) {
  return {
    task_id: t.id,
    date: t.date,
    project: t.project,
    ticket: t.ticket,
    related_tickets: t.related_tickets,
    title: t.title,
    hours: t.hours,
    hours_source: t.hours_source,
    active_minutes: t.active_minutes,
    summary_status: t.summary_status,
    items: t.items,
    notes: t.body || undefined,
    branch: t.branch,
    commits: t.commits,
    first_activity: t.first_activity,
    last_activity: t.last_activity,
    session_id: t.session_id,
  };
}

/** 擷取指定 session（確保當天有任務檔），回傳任務與擷取結果 */
async function ensureTask(ctx: ToolContext, config: Config, sessionIdArg: string | undefined, date: string, toolName: string) {
  const sessionId = resolveSessionId(ctx.paths, sessionIdArg, ctx.cwd, ctx.now?.(), toolName);
  const transcript = findTranscriptPath(ctx.paths, sessionId, ctx.cwd);
  let capture: Awaited<ReturnType<typeof captureSession>> | undefined;
  if (transcript) {
    capture = await captureSession({ paths: ctx.paths, config, transcriptPath: transcript, sessionId, cwd: ctx.cwd, force: true, ensureDate: date });
  }
  const file = findTaskFile(ctx.paths, date, sessionId);
  const task = file ? readTask(file) : null;
  if (!task) throw new ToolError(`找不到這個對話在 ${date} 的紀錄（session ${sessionId}）：對話紀錄可能還沒寫入，請在對話中多做一些事後再試；若確定是別的對話，請帶上正確的 session_id`);
  return { sessionId, task, capture };
}

// ───────────── 輸入 schema（SDK 與測試共用）

const PeriodInput = z.union([
  z.enum(['current', 'previous']),
  z.object({ start: IsoDate, end: IsoDate }),
  z.string().describe('期間標籤（例如 2026-W46、2026-Q4）或 YYYY-MM-DD~YYYY-MM-DD'),
]);

export const schemas = {
  worklog_get_summary_guide: {
    session_id: z.string().optional().describe('通常不需要：省略時自動判斷呼叫端的對話；判斷失敗時才帶對話開頭 [Worktrail] 訊息中的 session_id'),
    date: IsoDate.optional().describe('YYYY-MM-DD，預設今天'),
    prompt: z.string().optional().describe('摘要範本，例如 summary/default'),
  },
  worklog_save_summary: {
    session_id: z.string().optional().describe('通常不需要：省略時自動判斷呼叫端的對話；判斷失敗時才帶對話開頭 [Worktrail] 訊息中的 session_id'),
    date: IsoDate.optional().describe('YYYY-MM-DD，預設今天'),
    title: z.string().optional().describe('任務標題；有 Jira 單號時沿用單號標題'),
    items: z
      .array(z.object({ text: z.string().min(1).max(200), status: ItemStatus, note: z.string().optional() }))
      .min(1)
      .max(30)
      .describe('完整的子項清單（整批取代）；skipped 與 blocked 必須填 note'),
    notes: z.string().optional().describe('寫入任務內文的補充說明'),
    project: z.string().optional(),
    ticket: z.string().optional(),
    hours_estimate: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe('粗估今天花在這個任務的時數，0.5 為單位；同一天各任務加總超過設定的每日工時（預設 8h）時，系統會依比例縮減'),
    prompt_name: z.string().optional().describe('只有用 worklog_get_summary_guide 取得非預設範本時才需要，原樣帶回'),
    prompt_hash: z.string().optional().describe('同上'),
  },
  worklog_get_task: {
    task_id: z.string().optional(),
    session_id: z.string().optional(),
    date: IsoDate.optional(),
  },
  worklog_list_tasks: {
    from: IsoDate,
    to: IsoDate,
    project: z.string().optional(),
    ticket: z.string().optional(),
    summary_status: SummaryStatus.optional(),
  },
  worklog_report_prepare: {
    type: ReportType,
    period: PeriodInput.optional(),
    prompt: z.string().optional(),
  },
  worklog_report_save: {
    type: ReportType,
    period_id: z.string().min(1).describe('worklog_report_prepare 回傳的 period_id，例如 2026-W46'),
    content: z.string().min(1).describe('撰寫好的 Markdown 內容'),
    overwrite: z.boolean().optional().describe('報告已被手動編輯過時，確認要覆蓋才帶 true'),
  },
  worklog_open_ui: {},
};

type Args<K extends keyof typeof schemas> = z.infer<z.ZodObject<(typeof schemas)[K]>>;

// ───────────── 實作

export const handlers = {
  async worklog_get_summary_guide(ctx: ToolContext, a: Args<'worklog_get_summary_guide'>) {
    const config = ctxConfig(ctx);
    const date = a.date ?? today(ctx, config);
    const { task } = await ensureTask(ctx, config, a.session_id, date, 'worklog_get_summary_guide');
    const g = buildSummaryGuide({ paths: ctx.paths, config, task, mode: 'mcp', prompt: a.prompt, today: today(ctx, config) });
    return {
      guide: g.guide,
      prompt_name: g.prompt_name,
      prompt_hash: g.prompt_hash,
      draft: {
        task_id: task.id,
        ticket: task.ticket,
        related_tickets: task.related_tickets,
        project: task.project,
        title: task.title,
        active_minutes: task.active_minutes,
        hours: task.hours,
        commits: task.commits,
        current_items: task.items,
      },
      previous_items: g.previous_items,
    };
  },

  async worklog_save_summary(ctx: ToolContext, a: Args<'worklog_save_summary'>) {
    const config = ctxConfig(ctx);
    const date = a.date ?? today(ctx, config);
    const input = SummaryInput.safeParse(a);
    if (!input.success) throw new ToolError(`參數有誤，請修正後重試：${input.error.issues.map((i) => `${i.path.join('.')}：${i.message}`).join('；')}`);
    const { sessionId, task, capture } = await ensureTask(ctx, config, a.session_id, date, 'worklog_save_summary');
    // 沒帶範本資訊時視為依預設範本撰寫（撰寫規則已放在工具說明中）
    const data = { ...input.data };
    if (!data.prompt_hash) {
      try {
        const d = summaryWritingRules(ctx.paths, config);
        data.prompt_name = d.prompt_name;
        data.prompt_hash = d.prompt_hash;
      } catch {
        // 預設範本讀不到：照舊記為未套用範本
      }
    }
    const { task: saved, warnings, day } = await applySummary(ctx.paths, config, task.path, data);
    // 記錄摘要當下的進展，作為把關基準
    if (capture?.ownEvents && capture.draft) {
      const latestSha = capture.draft.days.flatMap((d) => d.commits).at(-1)?.sha;
      const progress = measureProgress(capture.ownEvents, latestSha);
      await updateState(ctx.paths, (s) => {
        sessionState(s, sessionId).summary_progress = progress;
      });
    }
    // 前次未完成的項目應該保留在清單中（今天有進展就更新狀態，沒有就保留原狀態）
    const missing = saved.ticket ? missingCarryOver(carryOver(ctx.paths, saved.ticket, saved.date).items, saved.items) : [];
    return {
      task_id: saved.id,
      file_path: saved.path,
      ui_url: taskUrl(config, saved.id),
      summary_status: saved.summary_status,
      hours: saved.hours,
      ...(saved.hours_estimate !== undefined && saved.hours_estimate !== saved.hours ? { hours_estimate: saved.hours_estimate } : {}),
      day_total_hours: day.total,
      daily_hours: day.daily_hours,
      warnings,
      ...(missing.length
        ? {
            previous_open_items: missing,
            next_step: `同單號前次有 ${missing.length} 個未完成項目沒有出現在本次清單。請把它們加進 items（今天有進展就更新狀態，沒有就保留原狀態），再呼叫一次 worklog_save_summary（整批取代）；已用不同文字列入的可以忽略。`,
          }
        : {}),
    };
  },

  async worklog_get_task(ctx: ToolContext, a: Args<'worklog_get_task'>) {
    const config = ctxConfig(ctx);
    let t: TaskRecord | null = null;
    if (a.task_id) t = findTaskById(ctx.paths, a.task_id);
    else {
      const sid = resolveSessionId(ctx.paths, a.session_id, ctx.cwd, ctx.now?.(), 'worklog_get_task');
      const file = findTaskFile(ctx.paths, a.date ?? today(ctx, config), sid);
      t = file ? readTask(file) : null;
    }
    if (!t) throw new ToolError('找不到任務');
    return { ...taskView(t), ui_url: taskUrl(config, t.id) };
  },

  async worklog_list_tasks(ctx: ToolContext, a: Args<'worklog_list_tasks'>) {
    const tasks = listTasks(ctx.paths, a.from, a.to).filter(
      (t) =>
        (!a.project || t.project === a.project) &&
        (!a.ticket || t.ticket === a.ticket) &&
        (!a.summary_status || t.summary_status === a.summary_status),
    );
    return { count: tasks.length, tasks: tasks.map(taskView) };
  },

  async worklog_report_prepare(ctx: ToolContext, a: Args<'worklog_report_prepare'>) {
    const config = ctxConfig(ctx);
    let period: PeriodSpec | undefined;
    if (typeof a.period === 'string') {
      period = parsePeriodArg(a.type, a.period, config);
      if (!period) throw new ToolError(`無法辨識的期間：${a.period}`);
    } else period = a.period;
    const p = prepareReport({ paths: ctx.paths, config, type: a.type, period, prompt: a.prompt, today: today(ctx, config) });
    // 存檔時只需帶回 period_id；這裡記住用了哪個範本
    preparedPrompts.set(`${a.type}/${p.id}`, p.prompt_name);
    return {
      period: p.period,
      period_id: p.id,
      rendered_prompt: p.rendered_prompt,
      stats: p.stats,
      warnings: p.warnings,
      next_step: `依 rendered_prompt 撰寫後，呼叫 worklog_report_save（type=${a.type}、period_id=${p.id}、content）。統計數字只能引用 stats。`,
    };
  },

  async worklog_report_save(ctx: ToolContext, a: Args<'worklog_report_save'>) {
    const config = ctxConfig(ctx);
    const spec = parsePeriodArg(a.type, a.period_id, config);
    if (!spec) throw new ToolError(`無法辨識的期間：${a.period_id}。請帶 worklog_report_prepare 回傳的 period_id`);
    // 統計數字、來源與範本由伺服器重新計算，不需要 Claude 抄回
    const p = prepareReport({ paths: ctx.paths, config, type: a.type, period: spec, prompt: preparedPrompts.get(`${a.type}/${a.period_id}`), today: today(ctx, config) });
    const r = saveReport({
      paths: ctx.paths,
      config,
      type: a.type,
      period: p.period,
      prompt_name: p.prompt_name,
      prompt_hash: p.prompt_hash,
      sources: p.sources,
      sources_version: p.sources_version,
      stats: p.stats,
      content: a.content,
      overwrite: a.overwrite,
    });
    return { report_id: r.id, file_path: r.path, ui_url: `${currentUiUrl(config)}/${r.type === 'weekly' ? 'weekly' : 'performance'}/${r.id}` };
  },

  async worklog_open_ui(ctx: ToolContext) {
    const config = ctxConfig(ctx);
    const open = ctx.openUi ?? defaultOpenUi;
    const url = await open(config.ui.port);
    return { ui_url: url, message: '已開啟 Worktrail 視窗' };
  },
};

/** MCP 程序內記住 prepare 用的範本，save 時沿用（key：type/period_id） */
const preparedPrompts = new Map<string, string>();

/** 服務未執行時先在背景啟動，再開啟 UI 視窗；回傳 UI 網址 */
async function defaultOpenUi(port: number): Promise<string> {
  const { startDaemonDetached } = await import('../daemon/client.js');
  const { openAppWindow } = await import('../launcher/open.js');
  const info = await startDaemonDetached();
  const url = uiUrl(info?.port ?? port);
  await openAppWindow(url).catch(() => undefined);
  return url;
}

export const descriptions: Record<keyof typeof schemas, string> = {
  worklog_get_summary_guide: '（選用）取得已填入系統擷取資訊與前次未完成項目的摘要範本。一般直接呼叫 worklog_save_summary 即可；想先看擷取到的單號、時間、commit，或要用非預設範本時才呼叫。',
  worklog_save_summary: '寫入本對話今天的工作日誌：標題、子項（整批取代）、狀態、粗估時數。不需要帶 session_id，也不需要先呼叫其他工具。',
  worklog_get_task: '讀取單一任務（以 task_id，或 session_id＋日期）。',
  worklog_list_tasks: '依期間、專案、單號、摘要狀態查詢任務。',
  worklog_report_prepare: '準備週報或績效：回傳已填入資料的 prompt、統計數字與警告。',
  worklog_report_save: '儲存 Claude 撰寫的週報或績效：只需要 type、prepare 回傳的 period_id 與內容；統計數字與來源由伺服器處理。',
  worklog_open_ui: '開啟 Worktrail 工作日誌視窗（服務未執行時會先啟動），回傳 UI 網址。',
};

/** worklog_save_summary 的完整說明：附上使用者預設摘要範本的撰寫規則，讓 Claude 一次呼叫就能完成 */
export function saveSummaryDescription(paths: StoragePaths | null): string {
  const base = descriptions.worklog_save_summary;
  if (!paths) return base;
  try {
    const { rules } = summaryWritingRules(paths, loadConfig(paths).config);
    return rules
      ? `${base}

撰寫規則（使用者的預設範本）：
${rules}
- 同單號前次未完成的項目也要列入，今天有進展就更新狀態，沒有就保留原狀態（回應會提示遺漏的項目）。`
      : `${base}預設範本沒有「撰寫規則」段落，撰寫前請先呼叫 worklog_get_summary_guide。`;
  } catch {
    return base;
  }
}
