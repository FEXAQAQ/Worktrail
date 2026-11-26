/**
 * 規格 9.5：統計數字（純函式）。
 */
import { ITEM_STATUSES, OPEN_STATUSES, type Item, type ItemStatus, type Task } from '../schema/task.js';
import { groupMerged } from '../sync/task-merge.js';

export interface OpenItem {
  ticket: string | null;
  project: string;
  date: string;
  text: string;
  status: ItemStatus;
  note?: string;
}

export interface Stats {
  total_hours: number;
  days_worked: number;
  /** 合併紀錄算一個任務 */
  task_count: number;
  ticket_count: number;
  hours_by_project: { project: string; hours: number; ratio: number }[];
  hours_by_ticket: { ticket: string; title: string; hours: number }[];
  hours_by_date: { date: string; hours: number }[];
  items_by_status: Record<ItemStatus, number>;
  /** done ÷（全部子項 − skipped）；沒有子項時為 null */
  completion_rate: number | null;
  open_items: OpenItem[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const NO_TICKET = '(無單號)';
export const NO_PROJECT = '(未分類)';

type TaskLike = Pick<Task, 'date' | 'ticket' | 'project' | 'hours' | 'items' | 'title' | 'first_activity' | 'merged'>;

const rankKey = (t: TaskLike) => `${t.date}|${t.items.length > 0 ? 1 : 0}|${t.first_activity ?? ''}`;

/**
 * 同一單號跨多天時，子項以該單號在期間內最後一天的狀態為準，避免重複計算。
 * 沒有單號的任務各自計算。
 */
export function effectiveItems(tasks: readonly TaskLike[]): { task: TaskLike; items: Item[] }[] {
  const latestByTicket = new Map<string, TaskLike>();
  const result: { task: TaskLike; items: Item[] }[] = [];
  for (const t of tasks) {
    if (!t.ticket) {
      result.push({ task: t, items: t.items });
      continue;
    }
    const prev = latestByTicket.get(t.ticket);
    // 依（日期、是否有子項、開始時間）取最大者：同一天有多個任務（例如分叉對話）時，以有子項、較晚開始者為準
    if (!prev || rankKey(t) > rankKey(prev)) latestByTicket.set(t.ticket, t);
  }
  for (const t of latestByTicket.values()) result.push({ task: t, items: t.items });
  return result;
}

export function computeStats(tasks: readonly TaskLike[]): Stats {
  const total = tasks.reduce((a, t) => a + t.hours, 0);
  const byProject = new Map<string, number>();
  const byTicket = new Map<string, { hours: number; title: string }>();
  const byDate = new Map<string, number>();
  for (const t of tasks) {
    const p = t.project || NO_PROJECT;
    byProject.set(p, (byProject.get(p) ?? 0) + t.hours);
    const k = t.ticket ?? NO_TICKET;
    const cur = byTicket.get(k) ?? { hours: 0, title: '' };
    cur.hours += t.hours;
    if (t.title && t.ticket) cur.title = t.title;
    byTicket.set(k, cur);
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.hours);
  }

  const items_by_status = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
  const open_items: OpenItem[] = [];
  for (const { task, items } of effectiveItems(tasks)) {
    for (const i of items) {
      items_by_status[i.status]++;
      if (OPEN_STATUSES.includes(i.status)) {
        open_items.push({ ticket: task.ticket, project: task.project, date: task.date, text: i.text, status: i.status, note: i.note });
      }
    }
  }
  const all = Object.values(items_by_status).reduce((a, b) => a + b, 0);
  const denom = all - items_by_status.skipped;

  return {
    total_hours: r2(total),
    days_worked: new Set(tasks.filter((t) => t.hours > 0 || t.items.length > 0).map((t) => t.date)).size,
    task_count: groupMerged(tasks).length,
    ticket_count: new Set(tasks.map((t) => t.ticket).filter(Boolean)).size,
    hours_by_project: [...byProject]
      .map(([project, hours]) => ({ project, hours: r2(hours), ratio: total ? r2(hours / total) : 0 }))
      .sort((a, b) => b.hours - a.hours),
    hours_by_ticket: [...byTicket]
      .map(([ticket, v]) => ({ ticket, title: v.title, hours: r2(v.hours) }))
      .sort((a, b) => b.hours - a.hours),
    hours_by_date: [...byDate].map(([date, hours]) => ({ date, hours: r2(hours) })).sort((a, b) => a.date.localeCompare(b.date)),
    items_by_status,
    completion_rate: denom > 0 ? r2(items_by_status.done / denom) : null,
    open_items,
  };
}
