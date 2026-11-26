/**
 * 合併同一天、同專案的任務（規格未涵蓋，見 DECISIONS「合併同專案任務」）。
 *
 * 合併不搬動或刪除任務檔：被合併的任務標記 `merged: true` 並鎖定專案。
 * 同一天、同專案、帶標記的任務即為一筆合併紀錄，底下保留各任務的標題、時數與子項。
 * 各對話之後繼續進行時，擷取與摘要仍寫回各自的任務檔，合併紀錄自然跟著更新。
 */
import { z } from 'zod';
import type { Config } from '../schema/config.js';
import type { Task } from '../schema/task.js';
import { setProject } from './projects.js';

export const MergeInput = z.object({
  ids: z.array(z.string().min(1)).min(2, '至少選擇兩個任務'),
  project: z.string().trim().min(1, '請指定專案').max(100),
});
export type MergeInput = z.infer<typeof MergeInput>;

export const UnmergeInput = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

/** 檢查能否合併；可以時回傳 null */
export function mergeError(tasks: readonly Pick<Task, 'date'>[]): string | null {
  if (tasks.length < 2) return '至少選擇兩個任務';
  if (new Set(tasks.map((t) => t.date)).size > 1) return '只能合併同一天的任務';
  return null;
}

export function markMerged<T extends Task>(t: T, project: string, config: Pick<Config, 'projects'> = { projects: [] }): T {
  const locked = t.locked_fields.includes('project') ? t.locked_fields : [...t.locked_fields, 'project' as const];
  return { ...setProject(t, project, config), merged: true, locked_fields: locked };
}

export function unmarkMerged<T extends Task>(t: T): T {
  const next = { ...t };
  delete next.merged;
  return next;
}

type Mergeable = Pick<Task, 'date' | 'project' | 'merged' | 'hours'>;

export type TaskEntry<T extends Mergeable> =
  | { kind: 'task'; task: T }
  | { kind: 'group'; date: string; project: string; tasks: T[]; hours: number };

const groupKey = (t: Mergeable) => `${t.date}\u0000${t.project}`;

/**
 * 把合併的任務收成一組，保留原順序（組出現在第一個成員的位置）。
 * 同組只剩一個成員時當一般任務。
 */
export function groupMerged<T extends Mergeable>(tasks: readonly T[]): TaskEntry<T>[] {
  const members = new Map<string, T[]>();
  for (const t of tasks) {
    if (!t.merged || !t.project) continue;
    const k = groupKey(t);
    (members.get(k) ?? members.set(k, []).get(k)!).push(t);
  }
  const out: TaskEntry<T>[] = [];
  const emitted = new Set<string>();
  for (const t of tasks) {
    const k = groupKey(t);
    const group = t.merged && t.project ? members.get(k) : undefined;
    if (!group || group.length < 2) {
      out.push({ kind: 'task', task: t });
      continue;
    }
    if (emitted.has(k)) continue;
    emitted.add(k);
    const hours = Math.round(group.reduce((a, x) => a + x.hours, 0) * 100) / 100;
    out.push({ kind: 'group', date: t.date, project: t.project, tasks: group, hours });
  }
  return out;
}
