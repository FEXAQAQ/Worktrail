import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isoWeek,
  parsePeriodArg,
  parsePeriodId,
  performancePeriodOf,
  periodId,
  periodsBetween,
  resolvePeriod,
  weekOf,
  weeklyPeriodOf,
  weeksIn,
} from '../src/core/period/index.js';
import { formatRecords, formatStats } from '../src/core/prompt/format.js';
import { renderTemplate, unknownVariables, validatePrompt } from '../src/core/prompt/index.js';
import { isReportStale, prepareReport, saveReport } from '../src/core/report/prepare.js';
import { getReport } from '../src/core/report/store.js';
import { Config } from '../src/core/schema/config.js';
import type { Task } from '../src/core/schema/task.js';
import { computeStats } from '../src/core/stats/index.js';
import { writeTask } from '../src/core/storage/tasks.js';
import { condenseTranscript, maskSecrets } from '../src/core/summary/index.js';
import { emptyTask } from '../src/core/sync/merge.js';
import { makeEnv, type TestEnv } from './env.js';

const cfg = (o: Record<string, unknown> = {}) => Config.parse(o);

describe('期間', () => {
  it('週與 ISO 週次', () => {
    expect(weekOf('2026-11-12', 'monday')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(weekOf('2026-11-15', 'monday')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(weekOf('2026-11-12', 'sunday')).toEqual({ start: '2026-11-08', end: '2026-11-14' });
    expect(isoWeek('2026-11-12')).toEqual({ year: 2026, week: 46 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
  });

  it('週報檔名：週一起算用 ISO 週次，否則用日期區間；可還原', () => {
    const c = cfg();
    expect(periodId('weekly', { start: '2026-11-09', end: '2026-11-15' }, c)).toBe('2026-W46');
    expect(parsePeriodId('weekly', '2026-W46', c)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(parsePeriodId('weekly', '2026-W53', c)).toEqual({ start: '2026-12-28', end: '2027-01-03' });
    const sun = cfg({ report: { weekly: { start_day: 'sunday' } } });
    expect(periodId('weekly', { start: '2026-11-08', end: '2026-11-14' }, sun)).toBe('2026-11-08_2026-11-14');
  });

  it('績效期間：月、季、半年、年，支援非曆年考核年度', () => {
    expect(performancePeriodOf('2026-11-12', 'quarterly', 1)).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(performancePeriodOf('2026-11-12', 'half_yearly', 1)).toEqual({ start: '2026-07-01', end: '2026-12-31' });
    expect(performancePeriodOf('2026-02-28', 'monthly', 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    // 考核年度 4 月起：2026-02 屬於 FY2025 Q4（2026-01～03）
    expect(performancePeriodOf('2026-02-10', 'quarterly', 4)).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(performancePeriodOf('2026-11-12', 'yearly', 4)).toEqual({ start: '2026-04-01', end: '2027-03-31' });

    const q = cfg();
    expect(periodId('performance', { start: '2026-10-01', end: '2026-12-31' }, q)).toBe('2026-Q4');
    expect(parsePeriodId('performance', '2026-Q4', q)).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    const fy = cfg({ report: { performance: { period: 'quarterly', year_start_month: 4 } } });
    expect(periodId('performance', { start: '2026-01-01', end: '2026-03-31' }, fy)).toBe('FY2025-Q4');
    expect(parsePeriodId('performance', 'FY2025-Q4', fy)).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    const half = cfg({ report: { performance: { period: 'half_yearly' } } });
    expect(periodId('performance', { start: '2026-07-01', end: '2026-12-31' }, half)).toBe('2026-H2');
    const year = cfg({ report: { performance: { period: 'yearly' } } });
    expect(periodId('performance', { start: '2026-01-01', end: '2026-12-31' }, year)).toBe('2026');
    expect(parsePeriodId('performance', '2026', year)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    const month = cfg({ report: { performance: { period: 'monthly' } } });
    expect(periodId('performance', { start: '2026-11-01', end: '2026-11-30' }, month)).toBe('2026-11');
  });

  it('current／previous 與參數解析', () => {
    const c = cfg();
    expect(resolvePeriod('weekly', 'previous', c, '2026-11-12')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(resolvePeriod('performance', 'previous', c, '2026-11-12')).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(parsePeriodArg('weekly', '2026-11-01~2026-11-07', c)).toEqual({ start: '2026-11-01', end: '2026-11-07' });
    expect(parsePeriodArg('weekly', '2026-W46', c)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(parsePeriodArg('weekly', 'garbage', c)).toBeUndefined();
    expect(weeksIn({ start: '2026-11-01', end: '2026-11-30' }, c)).toHaveLength(6);
    expect(periodsBetween('weekly', '2026-10-28', '2026-11-12', c).map((p) => p.start)).toEqual(['2026-11-09', '2026-11-02', '2026-10-26']);
  });

  it('雙週報：依 anchor_date 對齊，current／previous／清單／缺少週報都以兩週為一期', () => {
    // 2026-11-02 所在週為某期第一週 → 期間 11-02～11-15、11-16～11-29
    const c = cfg({ report: { weekly: { length_weeks: 2, anchor_date: '2026-11-04' } } });
    expect(weeklyPeriodOf('2026-11-12', c.report.weekly)).toEqual({ start: '2026-11-02', end: '2026-11-15' });
    expect(weeklyPeriodOf('2026-11-16', c.report.weekly)).toEqual({ start: '2026-11-16', end: '2026-11-29' });
    // anchor 之前的日期也對齊同一相位
    expect(weeklyPeriodOf('2026-10-25', c.report.weekly)).toEqual({ start: '2026-10-19', end: '2026-11-01' });
    expect(resolvePeriod('weekly', 'current', c, '2026-11-12')).toEqual({ start: '2026-11-02', end: '2026-11-15' });
    expect(resolvePeriod('weekly', 'previous', c, '2026-11-12')).toEqual({ start: '2026-10-19', end: '2026-11-01' });
    expect(periodsBetween('weekly', '2026-10-20', '2026-11-20', c).map((p) => p.start)).toEqual(['2026-11-16', '2026-11-02', '2026-10-19']);
    expect(weeksIn({ start: '2026-11-01', end: '2026-11-30' }, c).map((p) => p.start)).toEqual(['2026-10-19', '2026-11-02', '2026-11-16', '2026-11-30']);
    // 兩週期間的檔名用日期區間，不用 ISO 週次
    expect(periodId('weekly', { start: '2026-11-02', end: '2026-11-15' }, c)).toBe('2026-11-02_2026-11-15');
    // 換另一個相位
    const other = cfg({ report: { weekly: { length_weeks: 2, anchor_date: '2026-11-09' } } });
    expect(weeklyPeriodOf('2026-11-12', other.report.weekly)).toEqual({ start: '2026-11-09', end: '2026-11-22' });
    // 週日起算 + 未設定 anchor（預設 2026-01-05 所在週，週日起算為 2026-01-04）
    const sun = cfg({ report: { weekly: { start_day: 'sunday', length_weeks: 2 } } });
    expect(weeklyPeriodOf('2026-01-04', sun.report.weekly)).toEqual({ start: '2026-01-04', end: '2026-01-17' });
    expect(weeklyPeriodOf('2026-01-18', sun.report.weekly)).toEqual({ start: '2026-01-18', end: '2026-01-31' });
  });

  it('週報週數設定驗證', () => {
    expect(cfg().report.weekly.length_weeks).toBe(1);
    expect(() => cfg({ report: { weekly: { length_weeks: 0 } } })).toThrow();
    expect(() => cfg({ report: { weekly: { length_weeks: 5 } } })).toThrow();
    expect(() => cfg({ report: { weekly: { anchor_date: '11/02' } } })).toThrow();
  });
});

const task = (o: Partial<Task>): Task => ({ ...emptyTask(`s-${Math.random()}`, o.date ?? '2026-11-10'), ...o });

describe('統計', () => {
  const tasks = [
    task({ date: '2026-11-10', ticket: 'TDDA-1', project: 'A', hours: 3, items: [{ text: 'a', status: 'pending' }, { text: 'b', status: 'todo' }] }),
    task({ date: '2026-11-11', ticket: 'TDDA-1', project: 'A', hours: 2, items: [{ text: 'a', status: 'done' }, { text: 'b', status: 'skipped', note: '不做' }] }),
    task({ date: '2026-11-11', ticket: null, project: 'B', hours: 1, items: [{ text: 'c', status: 'blocked', note: '等待' }] }),
  ];

  it('同一單號跨天時以最後一天的子項為準', () => {
    const s = computeStats(tasks);
    expect(s).toMatchObject({ total_hours: 6, days_worked: 2, task_count: 3, ticket_count: 1 });
    expect(s.items_by_status).toEqual({ done: 1, pending: 0, todo: 0, skipped: 1, blocked: 1 });
    expect(s.completion_rate).toBe(0.5);
    expect(s.open_items.map((i) => i.text)).toEqual(['c']);
    expect(s.hours_by_project).toEqual([
      { project: 'A', hours: 5, ratio: 0.83 },
      { project: 'B', hours: 1, ratio: 0.17 },
    ]);
    expect(s.hours_by_ticket[0]).toMatchObject({ ticket: 'TDDA-1', hours: 5 });
  });

  it('沒有子項時完成率為 null', () => {
    expect(computeStats([]).completion_rate).toBeNull();
  });

  it('records 與 stats 的 Markdown 格式', () => {
    const r = formatRecords([task({ date: '2026-11-12', project: '社交工程', ticket: 'TDDA-1869', title: '[BE] 發送演練 API + DB規劃', hours: 6, items: [{ text: '稽核 README', status: 'done', note: '未 commit' }] })]);
    expect(r).toBe('### 2026-11-12（四）\n#### 社交工程｜TDDA-1869 [BE] 發送演練 API + DB規劃｜6h\n- [完成] 稽核 README（未 commit）');
    expect(formatStats(computeStats(tasks))).toContain('| 完成率 | 50% |');
  });
});

describe('範本', () => {
  it('變數取代、未知變數保留', () => {
    expect(renderTemplate('{{a}} {{ b }} {{c}}', { a: '1', b: '2' })).toBe('1 2 {{c}}');
    expect(unknownVariables('{{records}} {{foo}} {{transcript}}', 'weekly')).toEqual(['foo', 'transcript']);
  });

  it('驗證：週報需要 {{records}}、類型一致', () => {
    expect(validatePrompt('weekly/x', '---\nname: x\n---\n{{records}}').errors).toEqual([]);
    expect(validatePrompt('weekly/x', '---\nname: x\n---\nhello').errors[0]).toContain('{{records}}');
    expect(validatePrompt('weekly/x', '---\nname: x\ntype: summary\n---\n{{records}}').errors[0]).toContain('不一致');
    expect(validatePrompt('bad', 'x').errors[0]).toContain('格式');
    expect(validatePrompt('summary/x', '---\nname: x\n---\n{{draft}}').errors).toEqual([]);
  });
});

describe('隱私', () => {
  it('遮蔽疑似密鑰', () => {
    const r = maskSecrets('連線 Password=abc123; 與 -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY----- 以及 ghp_' + 'a'.repeat(36));
    expect(r.text).not.toContain('abc123');
    expect(r.text).not.toContain('MIIE');
    expect(r.text).not.toContain('ghp_');
    expect(r.found).toEqual(expect.arrayContaining(['私鑰', '密碼或金鑰', 'GitHub token']));
    expect(maskSecrets('一般文字 token 數量').found).toEqual([]);
  });

  it('補寫輸入省略工具輸出，只保留工具名稱與路徑', () => {
    const text = condenseTranscript(
      [
        { ts: 1, role: 'user', text: '開始' },
        { ts: 2, role: 'tool_use', toolName: 'Read', toolInput: { file_path: 'C:/a.cs' } },
        { ts: 3, role: 'tool_result', text: 'SECRET FILE CONTENT' },
        { ts: 4, role: 'tool_use', toolName: 'Bash', toolInput: { command: 'export TOKEN=x', description: '設定環境' } },
        { ts: 5, role: 'assistant', text: '完成' },
        { ts: 6, role: 'user', text: '複製的', copied: true },
      ],
      10_000,
    );
    expect(text).toContain('🔧 Read：C:/a.cs');
    expect(text).toContain('🔧 Bash：設定環境');
    expect(text).not.toContain('SECRET FILE CONTENT');
    expect(text).not.toContain('export TOKEN');
    expect(text).not.toContain('複製的');
    const long = condenseTranscript(Array.from({ length: 200 }, (_, i) => ({ ts: i, role: 'user' as const, text: 'x'.repeat(100) })), 2000);
    expect(long.length).toBeLessThan(2200);
    expect(long).toContain('中間省略');
  });
});

describe('績效：缺少週報的提示與過期偵測', () => {
  let env: TestEnv;
  beforeAll(() => {
    env = makeEnv();
    for (const date of ['2026-10-06', '2026-10-14', '2026-10-21']) {
      writeTask(env.paths, task({ date, id: `${date}__TDDA-1__aaaaaa`, ticket: 'TDDA-1', hours: 4, items: [{ text: '做事', status: 'done' }] }));
    }
  });
  afterAll(() => env.cleanup());

  it('缺少週報時提示；補上後列入 records', () => {
    const c = cfg({ report: { performance: { period: 'monthly' } } });
    const p = prepareReport({ paths: env.paths, config: c, type: 'performance', period: { start: '2026-10-01', end: '2026-10-31' }, today: '2026-11-16' });
    expect(p.missing_weeks?.map((w) => w.start)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    expect(p.warnings.join()).toContain('2026-W41');
    expect(p.stats.total_hours).toBe(12);

    const w = prepareReport({ paths: env.paths, config: c, type: 'weekly', period: { start: '2026-10-05', end: '2026-10-11' }, today: '2026-11-16' });
    saveReport({ paths: env.paths, config: c, type: 'weekly', period: w.period, prompt_name: w.prompt_name, prompt_hash: w.prompt_hash, sources: w.sources, stats: w.stats, content: '# W41 週報內容', sources_version: w.sources_version });
    const p2 = prepareReport({ paths: env.paths, config: c, type: 'performance', period: { start: '2026-10-01', end: '2026-10-31' }, today: '2026-11-16' });
    expect(p2.missing_weeks).toHaveLength(2);
    expect(p2.rendered_prompt).toContain('# W41 週報內容');

    // 來源任務被修改 → 週報過期
    const r = getReport(env.paths, 'weekly', '2026-W41')!;
    expect(isReportStale(env.paths, r)).toBe(false);
    writeTask(env.paths, task({ date: '2026-10-06', id: '2026-10-06__TDDA-1__aaaaaa', ticket: 'TDDA-1', hours: 5 }));
    expect(isReportStale(env.paths, r)).toBe(true);
  });
});
