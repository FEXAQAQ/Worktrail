/**
 * 每日工時：AI 各自粗估每個任務的時數，同一天加總常超過正常工時（見 DECISIONS「每日工時上限」）。
 * 當天加總超過 `time.daily_hours` 時，依比例縮減 AI 粗估的任務；使用者填寫與系統計算的時數不動。
 */
import type { Config } from '../schema/config.js';
import type { Task } from '../schema/task.js';
import { withLock } from '../storage/fsutil.js';
import type { StoragePaths } from '../storage/paths.js';
import { listTasks, readTask, taskLockKey, writeTask, type TaskRecord } from '../storage/tasks.js';

type HoursTask = Pick<Task, 'hours' | 'hours_source' | 'hours_overridden' | 'hours_estimate'>;

/** 參與比例調整的任務：AI 粗估且未被使用者修改 */
export function isAdjustable(t: HoursTask): boolean {
  return t.hours_source === 'ai' && !t.hours_overridden;
}

/** AI 原本的粗估（調整前） */
export function rawHours(t: HoursTask): number {
  return t.hours_estimate ?? t.hours;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 計算當天每個任務的時數（回傳與輸入同順序）。
 * - 不可調整的任務（使用者填寫、系統計算）照舊，先占用工時。
 * - AI 粗估加總未超過剩餘工時：用原本的粗估。
 * - 超過：依粗估比例分配剩餘工時，以 rounding 為單位（最大餘數法），每個任務至少一個單位。
 *   固定時數已占滿工時、或任務多到每個一個單位就超過時，仍保留每個一個單位（加總可能超過）。
 * daily_hours 為 0 時不調整。
 */
export function balanceDayHours(tasks: readonly HoursTask[], config: Config): number[] {
  const daily = config.time.daily_hours;
  const unit = config.time.rounding > 0 ? config.time.rounding : 0.5;
  const out = tasks.map((t) => (isAdjustable(t) ? rawHours(t) : t.hours));
  if (daily <= 0) return out;
  const flex = tasks.map((t, i) => ({ i, raw: rawHours(t) })).filter(({ i, raw }) => isAdjustable(tasks[i]!) && raw > 0);
  if (!flex.length) return out;
  const fixed = tasks.reduce((s, t) => s + (isAdjustable(t) ? 0 : t.hours), 0);
  const budget = Math.max(0, daily - fixed);
  const total = flex.reduce((s, f) => s + f.raw, 0);
  if (total <= budget + 1e-9) return out;

  const units = Math.floor(budget / unit + 1e-9);
  const shares = flex.map((f) => {
    const exact = (f.raw / total) * units;
    return { ...f, n: Math.max(1, Math.floor(exact + 1e-9)), rem: exact - Math.floor(exact + 1e-9) };
  });
  let left = units - shares.reduce((s, x) => s + x.n, 0);
  // 多出來的單位給餘數最大者；不足時（最低一個單位造成）從分到最多的扣回
  const byRem = [...shares].sort((a, b) => b.rem - a.rem || b.raw - a.raw);
  for (let k = 0; left > 0 && k < byRem.length; k++, left--) byRem[k]!.n++;
  while (left < 0) {
    const top = shares.filter((x) => x.n > 1).sort((a, b) => b.n - a.n || a.rem - b.rem)[0];
    if (!top) break;
    top.n--;
    left++;
  }
  for (const s of shares) out[s.i] = round2(Math.min(s.n * unit, s.raw));
  return out;
}

export interface DayHoursSummary {
  date: string;
  daily_hours: number;
  total: number;
  /** 被縮減的任務數 */
  adjusted: number;
}

/**
 * 依每日工時重新分配某天 AI 粗估任務的時數，寫回有變動的任務檔。
 * 回傳寫入的任務（daemon 用來更新索引）與當天加總。
 */
export async function rebalanceDay(
  paths: StoragePaths,
  config: Config,
  date: string,
): Promise<{ written: TaskRecord[]; summary: DayHoursSummary }> {
  const tasks = listTasks(paths, date, date);
  const target = balanceDayHours(tasks, config);
  const written: TaskRecord[] = [];
  for (const [i, t] of tasks.entries()) {
    if (!isAdjustable(t)) continue;
    const want = target[i]!;
    const needsRaw = t.hours_estimate === undefined && want !== t.hours;
    if (want === t.hours && !needsRaw) continue;
    const saved = await withLock(taskLockKey(paths, t.date, t.session_id), () => {
      const latest = readTask(t.path);
      // 鎖外讀到之後已被改成使用者時數或刪除：略過
      if (!latest || !isAdjustable(latest) || rawHours(latest) !== rawHours(t)) return null;
      return writeTask(paths, { ...latest, hours_estimate: rawHours(latest), hours: want }, latest.path);
    });
    if (saved) written.push(saved);
  }
  const total = round2(target.reduce((s, h) => s + h, 0));
  const adjusted = tasks.filter((t, i) => isAdjustable(t) && target[i]! < rawHours(t)).length;
  return { written, summary: { date, daily_hours: config.time.daily_hours, total, adjusted } };
}
