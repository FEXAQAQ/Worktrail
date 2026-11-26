/**
 * 使用者在 UI 修改任務（規格 4.2、11.4）。修改過的共用欄位會被鎖定，擷取程式之後不再覆寫。
 */
import { z } from 'zod';
import { roundHours } from '../capture/active-time.js';
import type { Config } from '../schema/config.js';
import { Item, LockableField, taskId, type Task } from '../schema/task.js';
import { maskSecrets } from '../summary/index.js';
import { assignProject } from './projects.js';

export const TaskPatch = z.object({
  title: z.string().max(200).optional(),
  project: z.string().max(100).optional(),
  ticket: z.string().max(50).nullable().optional(),
  /** null 代表還原為系統計算值 */
  hours: z.number().min(0).max(24).nullable().optional(),
  items: z.array(Item).max(30).optional(),
  body: z.string().optional(),
  summary_status: z.enum(['draft', 'done', 'stale']).optional(),
  /** 解除鎖定，讓擷取程式重新自動判斷 */
  unlock: z.array(LockableField).optional(),
});
export type TaskPatch = z.infer<typeof TaskPatch>;

export function applyTaskPatch(t: Task, patch: TaskPatch, config: Config): { task: Task; warnings: string[] } {
  const next: Task = { ...t, locked_fields: [...t.locked_fields] };
  const warnings: string[] = [];
  const mask = (s: string) => {
    const r = maskSecrets(s);
    for (const f of r.found) warnings.push(`偵測到疑似${f}，已遮蔽`);
    return r.text;
  };
  const lock = (f: LockableField) => {
    if (!next.locked_fields.includes(f)) next.locked_fields.push(f);
  };

  if (patch.title !== undefined) {
    next.title = mask(patch.title);
    next.title_source = 'user';
  }
  if (patch.project !== undefined) {
    // 已合併的任務改到別的專案，就離開原本的合併紀錄
    if (next.merged && patch.project !== t.project) delete next.merged;
    assignProject(next, patch.project, config);
    lock('project');
  }
  if (patch.ticket !== undefined) {
    next.ticket = patch.ticket?.trim() || null;
    lock('ticket');
  }
  if (patch.hours !== undefined) {
    delete next.hours_estimate;
    if (patch.hours === null) {
      next.hours = roundHours(t.active_minutes, config.time.rounding);
      next.hours_overridden = false;
      next.hours_source = 'computed';
    } else {
      next.hours = patch.hours;
      next.hours_overridden = true;
      next.hours_source = 'user';
    }
  }
  if (patch.items !== undefined) {
    next.items = patch.items.map((i) => ({ ...i, text: mask(i.text), note: i.note ? mask(i.note) : undefined }));
    if (next.summary_status === 'draft' && next.items.length) {
      next.summary_status = 'done';
      next.summary_updated_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      next.summary_prompt ??= 'none';
    }
  }
  if (patch.body !== undefined) next.body = mask(patch.body);
  if (patch.summary_status !== undefined) next.summary_status = patch.summary_status;
  for (const f of patch.unlock ?? []) next.locked_fields = next.locked_fields.filter((x) => x !== f);

  next.id = taskId(next.date, next.ticket, next.session_id);
  return { task: next, warnings: [...new Set(warnings)] };
}
