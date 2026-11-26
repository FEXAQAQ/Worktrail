import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentSources, isReportStale, prepareReport, saveReport } from '../src/core/report/prepare.js';
import { countInRange, ReportFileCache, searchReports, type ReportSource } from '../src/core/report/source.js';
import * as store from '../src/core/report/store.js';
import { Config } from '../src/core/schema/config.js';
import type { Task } from '../src/core/schema/task.js';
import { listTasks, writeTask } from '../src/core/storage/tasks.js';
import { emptyTask } from '../src/core/sync/merge.js';
import { makeEnv, type TestEnv } from './env.js';

const task = (o: Partial<Task>): Task => ({ ...emptyTask(`s-${Math.random()}`, o.date ?? '2026-11-10'), ...o });
const c = Config.parse({});

describe('countInRange', () => {
  it('含頭尾計數，空陣列與無交集為 0', () => {
    const d = ['2026-10-01', '2026-10-05', '2026-10-05', '2026-10-07', '2026-10-12'];
    expect(countInRange(d, '2026-10-05', '2026-10-07')).toBe(3);
    expect(countInRange(d, '2026-09-01', '2026-12-31')).toBe(5);
    expect(countInRange(d, '2026-10-08', '2026-10-11')).toBe(0);
    expect(countInRange(d, '2026-10-12', '2026-10-01')).toBe(0);
    expect(countInRange([], '2026-10-01', '2026-10-31')).toBe(0);
  });
});

describe('報告資料來源與快取', () => {
  let env: TestEnv;
  beforeAll(() => {
    env = makeEnv();
    writeTask(env.paths, task({ date: '2026-10-06', id: '2026-10-06__TDDA-1__aaaaaa', ticket: 'TDDA-1', hours: 4 }));
    const w = prepareReport({ paths: env.paths, config: c, type: 'weekly', period: { start: '2026-10-05', end: '2026-10-11' }, today: '2026-11-16' });
    saveReport({ paths: env.paths, config: c, type: 'weekly', period: w.period, prompt_name: w.prompt_name, prompt_hash: w.prompt_hash, sources: w.sources, stats: w.stats, content: '# W41 發送演練 API', sources_version: w.sources_version });
  });
  afterAll(() => env.cleanup());

  it('快取只重讀有變動的檔案，並反映外部修改與刪除', () => {
    const cache = new ReportFileCache(env.paths);
    expect(cache.list('weekly').map((r) => r.id)).toEqual(['2026-W41']);
    // 檔案未變動時回傳同一個物件（未重讀）
    const first = cache.list('weekly')[0];
    expect(cache.list('weekly')[0]).toBe(first);

    // 外部修改（例如手動編輯）：大小改變 → 重讀
    const path = first!.path;
    writeFileSync(path, readFileSync(path, 'utf8').replace('發送演練 API', '發送演練 API（已修改）'));
    const second = cache.list('weekly')[0]!;
    expect(second).not.toBe(first);
    expect(second.body).toContain('已修改');

    rmSync(path);
    expect(cache.list('weekly')).toEqual([]);
    expect(cache.list('performance')).toEqual([]);
  });

  it('過期判斷可改用注入的來源，不讀任務檔', () => {
    const w = prepareReport({ paths: env.paths, config: c, type: 'weekly', period: { start: '2026-10-05', end: '2026-10-11' }, today: '2026-11-16' });
    const saved = saveReport({ paths: env.paths, config: c, type: 'weekly', period: w.period, prompt_name: w.prompt_name, prompt_hash: w.prompt_hash, sources: w.sources, stats: w.stats, content: '# W41', sources_version: w.sources_version });
    const tasks = listTasks(env.paths, '2026-10-05', '2026-10-11');
    const calls: string[] = [];
    const source: ReportSource = {
      tasks: (from, to) => {
        calls.push(`${from}~${to}`);
        return tasks;
      },
      reports: () => [saved],
    };
    expect(isReportStale(env.paths, saved, source)).toBe(false);
    expect(calls).toEqual(['2026-10-05~2026-10-11']);
    // 記憶體中的任務版本變了 → 過期
    const changed: ReportSource = { ...source, tasks: () => tasks.map((t) => ({ ...t, version: 'changed' })) };
    expect(isReportStale(env.paths, saved, changed)).toBe(true);
    expect(currentSources(env.paths, 'weekly', w.period, source).ids).toEqual(['2026-10-06__TDDA-1__aaaaaa']);
  });

  it('搜尋比對期間標籤與內文，不分大小寫；空字串不搜尋', () => {
    const r = store.getReport(env.paths, 'weekly', '2026-W41')!;
    const source: ReportSource = { tasks: () => [], reports: (type) => (type === 'weekly' ? [r] : []) };
    expect(searchReports(source, 'w41')).toEqual([{ type: 'weekly', id: '2026-W41', period: { start: '2026-10-05', end: '2026-10-11' } }]);
    expect(searchReports(source, '  ')).toEqual([]);
    expect(searchReports(source, '找不到')).toEqual([]);
  });
});
