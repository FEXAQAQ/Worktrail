/**
 * 「複製 Jira 進度」的純函式：不碰 DOM，供單元測試。見 DECISIONS.md「複製 Jira 進度」。
 * 輸出乾淨的純文字，貼到 Jira 卡片留言；日期行「YYYY/MM/DD」可被「從 Jira 整理」（core/summary/jira.ts）讀回。
 */
import { displayTitle, STATUS_LABEL } from './task-text.js';

type ItemStatus = keyof typeof STATUS_LABEL;

export interface CopyTask {
  id: string;
  date: string;
  ticket: string | null;
  title: string;
  items: { text: string; status: ItemStatus; note?: string | undefined }[];
  first_activity?: string | undefined;
}

const sameTicket = (a: string | null, b: string | null) => !!a && !!b && a.toUpperCase() === b.toUpperCase();

/** 與 task 同一天、同單號的任務（依開始時間排序）；沒有單號時只有它自己 */
export function tasksForTicket<T extends CopyTask>(all: readonly T[], task: T): T[] {
  if (!task.ticket) return [task];
  const list = all.filter((t) => t.date === task.date && sameTicket(t.ticket, task.ticket));
  if (!list.some((t) => t.id === task.id)) list.push(task);
  return list.sort((a, b) => (a.first_activity ?? '').localeCompare(b.first_activity ?? ''));
}

/** 去掉 Markdown 標記與換行，保持純文字 */
export function plain(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
}

/** YYYY-MM-DD → 「YYYY/MM/DD」 */
export function progressHeading(date: string): string {
  return date.replaceAll('-', '/');
}

/**
 * 組成一張 Jira 卡片的當日進度。
 * - 子項：「- [狀態] 內容（備註）」，跨任務相同內容只列一次。
 * - 所有任務都沒有子項時，改列標題（titleOnly = true，讓 UI 提示尚未撰寫摘要）。
 */
export function jiraProgressText(tasks: readonly CopyTask[]): { text: string; items: number; titleOnly: boolean } {
  const date = tasks[0]?.date ?? '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const t of tasks) {
    for (const i of t.items) {
      const text = plain(i.text);
      if (!text) continue;
      const note = i.note ? plain(i.note) : '';
      const line = `- [${STATUS_LABEL[i.status]}] ${text}${note ? `（${note}）` : ''}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  const items = lines.length;
  if (!items) {
    for (const t of tasks) {
      const title = plain(displayTitle(t));
      if (title && !seen.has(title)) {
        seen.add(title);
        lines.push(`- ${title}`);
      }
    }
  }
  return { text: [progressHeading(date), ...lines].join('\n'), items, titleOnly: items === 0 };
}
