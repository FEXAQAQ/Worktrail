import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig, type Config } from '../src/core/schema/config.js';
import type { Task } from '../src/core/schema/task.js';
import { listTasks, writeTask } from '../src/core/storage/tasks.js';
import { applySummary, dayHoursHint } from '../src/core/summary/index.js';
import { balanceDayHours, rebalanceDay } from '../src/core/sync/day-hours.js';
import { emptyTask } from '../src/core/sync/merge.js';
import { makeEnv, type TestEnv } from './env.js';

let n = 0;
const DATE = '2026-11-18';
const task = (o: Partial<Task>): Task => ({ ...emptyTask(`${String(++n).padStart(4, '0')}ffff-0000-4000-8000-000000000000`, DATE), ...o });
const ai = (h: number) => task({ hours: h, hours_source: 'ai' });
const user = (h: number) => task({ hours: h, hours_source: 'user', hours_overridden: true });
const cfg = (daily: number, rounding = 0.5): Config => {
  const c = defaultConfig();
  return { ...c, time: { ...c.time, daily_hours: daily, rounding } };
};

describe('每日工時分配', () => {
  it('預設每日工時 8 小時', () => {
    expect(defaultConfig().time.daily_hours).toBe(8);
  });

  it('加總未超過工時：維持 AI 粗估', () => {
    expect(balanceDayHours([ai(3), ai(4)], cfg(8))).toEqual([3, 4]);
  });

  it('超過工時：依比例縮減，加總剛好等於工時', () => {
    const r = balanceDayHours([ai(6), ai(4), ai(2)], cfg(8));
    expect(r.reduce((a, b) => a + b, 0)).toBe(8);
    expect(r).toEqual([4, 2.5, 1.5]);
  });

  it('使用者填寫與系統計算的時數不動，先占用工時', () => {
    const computed = task({ hours: 1, hours_source: 'computed' });
    const r = balanceDayHours([user(3), computed, ai(4), ai(4)], cfg(8));
    expect(r.slice(0, 2)).toEqual([3, 1]);
    expect(r[2]! + r[3]!).toBe(4);
  });

  it('固定時數已占滿：每個 AI 任務仍保留一個單位', () => {
    expect(balanceDayHours([user(8), ai(3), ai(2)], cfg(8))).toEqual([8, 0.5, 0.5]);
  });

  it('依調整前的粗估計算，重複分配結果不變', () => {
    const tasks = [
      { ...ai(4), hours_estimate: 6 },
      { ...ai(2.5), hours_estimate: 4 },
      { ...ai(1.5), hours_estimate: 2 },
    ];
    expect(balanceDayHours(tasks, cfg(8))).toEqual([4, 2.5, 1.5]);
    // 工時放寬後回到原本的粗估
    expect(balanceDayHours(tasks, cfg(12))).toEqual([6, 4, 2]);
    expect(balanceDayHours(tasks, cfg(0))).toEqual([6, 4, 2]);
  });

  it('時數單位 1 小時', () => {
    const r = balanceDayHours([ai(5), ai(5), ai(5)], cfg(8, 1));
    expect(r.reduce((a, b) => a + b, 0)).toBe(8);
    expect(r.every((h) => Number.isInteger(h))).toBe(true);
  });
});

describe('寫入與摘要', () => {
  let env: TestEnv;
  beforeEach(() => {
    env = makeEnv();
  });
  afterEach(() => env.cleanup());

  it('rebalanceDay 寫回縮減後的時數並保留原本的粗估', async () => {
    writeTask(env.paths, ai(6));
    writeTask(env.paths, ai(6));
    writeTask(env.paths, user(2));
    const r = await rebalanceDay(env.paths, cfg(8), DATE);
    expect(r.summary).toMatchObject({ total: 8, adjusted: 2 });
    const saved = listTasks(env.paths, DATE, DATE).filter((t) => t.hours_source === 'ai');
    expect(saved.map((t) => [t.hours, t.hours_estimate])).toEqual([
      [3, 6],
      [3, 6],
    ]);
    // 再跑一次沒有變動
    expect((await rebalanceDay(env.paths, cfg(8), DATE)).written).toHaveLength(0);
  });

  it('寫入摘要時依當天其他任務調整，並回報警告', async () => {
    writeTask(env.paths, ai(5));
    const t = writeTask(env.paths, task({}));
    const config = cfg(8);
    expect(dayHoursHint(env.paths, config, t)).toContain('已記 5h，剩餘約 3h');
    const r = await applySummary(env.paths, config, t.path, { items: [{ text: '做事', status: 'done' }], hours_estimate: 5 });
    expect(r.task).toMatchObject({ hours: 4, hours_estimate: 5, hours_source: 'ai' });
    expect(r.day.total).toBe(8);
    expect(r.warnings.join()).toContain('依比例調整為 4h');
  });
});
