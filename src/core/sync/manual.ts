/**
 * 手動新增任務：記錄不在 Claude Code 中進行的工作（會議、手動測試、文件、支援等）。
 * 以隨機 UUID 作為 session_id，沒有對話紀錄，擷取程式與補漏掃描都不會碰它。
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IsoDate, Item, taskId, type Task } from '../schema/task.js';
import { maskSecrets } from '../summary/index.js';
import type { Config } from '../schema/config.js';
import { emptyTask } from './merge.js';
import { setProject } from './projects.js';

export const ManualTaskInput = z.object({
  date: IsoDate,
  title: z.string().trim().min(1, '請填寫標題').max(200),
  project: z.string().trim().max(100).default(''),
  ticket: z.string().trim().max(50).nullable().optional(),
  hours: z.number().min(0).max(24).default(0),
  items: z.array(Item).max(30).default([]),
  body: z.string().default(''),
});
export type ManualTaskInput = z.input<typeof ManualTaskInput>;

export function createManualTask(input: ManualTaskInput, config: Pick<Config, 'projects'> = { projects: [] }): Task {
  const i = ManualTaskInput.parse(input);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const sessionId = randomUUID();
  const ticket = i.ticket?.trim() ? i.ticket.trim().toUpperCase() : null;
  const base = setProject(emptyTask(sessionId, i.date), i.project, config);
  return {
    ...base,
    id: taskId(i.date, ticket, sessionId),
    manual: true,
    title: maskSecrets(i.title).text,
    title_source: 'user',
    ticket,
    hours: i.hours,
    hours_overridden: true,
    hours_source: 'user',
    locked_fields: ['project', 'ticket'],
    items: i.items.map((it) => ({ ...it, text: maskSecrets(it.text).text })),
    body: maskSecrets(i.body).text,
    // 手動任務本身就是使用者寫的摘要，不需要「補寫摘要」
    summary_status: 'done',
    summary_updated_at: now,
    summary_prompt: 'none',
  };
}

/** 專案名稱清單：設定中的專案在前，其次是任務中用過的名稱（依使用次數） */
export function projectNames(config: { projects: { name: string }[] }, tasks: readonly Pick<Task, 'project'>[]): string[] {
  const counts = new Map<string, number>();
  for (const t of tasks) if (t.project) counts.set(t.project, (counts.get(t.project) ?? 0) + 1);
  const configured = config.projects.map((p) => p.name).filter(Boolean);
  const used = [...counts].sort((a, b) => b[1] - a[1]).map(([p]) => p).filter((p) => !configured.includes(p));
  return [...new Set([...configured, ...used])];
}
