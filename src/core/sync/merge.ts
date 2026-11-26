/**
 * 將擷取結果合併進任務檔（純函式）。規格 4.2 的欄位歸屬：
 * - 擷取欄位：每次覆寫。
 * - 摘要欄位：不動（摘要寫入前，標題可用擷取到的候選）。
 * - 共用欄位：給預設值；使用者鎖定或修改後不再覆寫。
 */
import type { DayDraft, SessionDraft } from '../capture/analyze.js';
import type { Config } from '../schema/config.js';
import { taskId, type Task } from '../schema/task.js';
import { applyResolvedProject } from './projects.js';

/** 摘要後超過此時間仍有活動，視為摘要過期 */
const STALE_AFTER_MS = 60 * 60_000;

export function emptyTask(sessionId: string, date: string): Task {
  return {
    schema: 1,
    id: taskId(date, null, sessionId),
    session_id: sessionId,
    date,
    project: '',
    ticket: null,
    related_tickets: [],
    hours: 0,
    hours_overridden: false,
    hours_source: 'computed',
    locked_fields: [],
    title: '',
    items: [],
    summary_status: 'draft',
    repo: '',
    branch: '',
    active_minutes: 0,
    commits: [],
    body: '',
  };
}

export function mergeCapture(args: {
  existing: Task | null;
  draft: SessionDraft;
  day: DayDraft;
  config: Config;
  /** 即使低於 min_active_minutes 也建立 */
  force?: boolean;
}): Task | null {
  const { existing, draft, day, config } = args;
  if (!existing && !args.force && day.active_minutes < config.capture.min_active_minutes && day.commits.length === 0) {
    return null;
  }
  const t: Task = existing ? { ...existing } : emptyTask(draft.session_id, day.date);
  const locked = new Set(t.locked_fields);

  // 擷取欄位
  t.session_id = draft.session_id;
  t.repo = draft.repo;
  t.branch = draft.branch;
  t.first_activity = day.first_activity;
  t.last_activity = day.last_activity;
  t.active_minutes = day.active_minutes;
  const prevShas = new Set(t.commits.map((c) => c.sha));
  t.commits = day.commits;

  // 共用欄位
  if (!locked.has('ticket')) {
    t.ticket = draft.ticket;
    t.related_tickets = draft.related_tickets;
  }
  const withProject = applyResolvedProject(
    t,
    { project: draft.project, project_id: draft.project_id, unmapped: draft.project_unmapped },
    existing === null,
  );
  t.project = withProject.project;
  t.project_unmapped = withProject.project_unmapped;
  if (withProject.project_id) t.project_id = withProject.project_id;
  else delete t.project_id;
  if (!t.hours_overridden && t.hours_source === 'computed') t.hours = day.hours;

  // 摘要前的標題候選
  if (t.title_source !== 'summary' && t.title_source !== 'user' && draft.title) {
    t.title = draft.title.title;
    t.title_source = draft.title.source;
  }

  // 摘要過期：摘要後出現新 commit，或摘要後仍持續工作超過一小時
  if (t.summary_status === 'done' && t.summary_updated_at) {
    const summaryTs = Date.parse(t.summary_updated_at);
    const newCommit = day.commits.some((c) => !prevShas.has(c.sha)) && existing !== null;
    const laterWork = Date.parse(day.last_activity) - summaryTs > STALE_AFTER_MS;
    if (newCommit || laterWork) t.summary_status = 'stale';
  }

  t.id = taskId(t.date, t.ticket, t.session_id);
  return t;
}
