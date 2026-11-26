/** 從 daemon 路由搬到 core 的整理邏輯 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyTicketKeyAction, tasksMentioningKey } from '../src/core/capture/ticket.js';
import { defaultPromptRefs, promptDeleteError } from '../src/core/prompt/index.js';
import { editedReport, listReportPeriods, weeklyHours } from '../src/core/report/list.js';
import type { ReportSource } from '../src/core/report/source.js';
import type { ReportRecord } from '../src/core/report/store.js';
import { Config } from '../src/core/schema/config.js';
import { projectRuleSummaries } from '../src/core/sync/projects.js';
import { applyTalkEdit, talkIdFromTrash, talkStatus, type TalkRecord } from '../src/core/talk/index.js';
import { makeEnv, type TestEnv } from './env.js';

const c = Config.parse({});

const report = (o: Partial<ReportRecord>): ReportRecord => ({
  schema: 1,
  type: 'weekly',
  id: '2026-W41',
  period_start: '2026-10-05',
  period_end: '2026-10-11',
  prompt: 'weekly/default',
  prompt_hash: 'h',
  sources: [],
  stats: {},
  generated_at: '2026-10-12T00:00:00Z',
  edited: false,
  stale: false,
  body: '內容',
  path: '',
  version: 'v',
  ...o,
});

describe('報告清單', () => {
  let env: TestEnv;
  beforeAll(() => (env = makeEnv()));
  afterAll(() => env.cleanup());

  it('列出第一筆任務到今天的每一週，附狀態與任務數；自訂期間的報告也列入', () => {
    const reports = [
      report({ id: '2026-W41', edited: true }),
      report({ id: '2026-W42', period_start: '2026-10-12', period_end: '2026-10-18', stale: true }),
      report({ id: '2026-10-01_2026-10-03', period_start: '2026-10-01', period_end: '2026-10-03' }),
    ];
    const source: ReportSource = { tasks: () => [], reports: (t) => (t === 'weekly' ? reports : []) };
    const list = listReportPeriods({
      paths: env.paths,
      config: c,
      type: 'weekly',
      taskDates: ['2026-10-14', '2026-10-06', '2026-10-07', '2026-10-21'],
      today: '2026-10-22',
      source,
    });
    expect(list.map((r) => [r.id, r.status, r.task_count])).toEqual([
      ['2026-W43', 'none', 1],
      ['2026-W42', 'stale', 1],
      ['2026-W41', 'edited', 2],
      ['2026-10-01_2026-10-03', 'generated', 0],
    ]);
  });

  it('沒有任務時只列今天這一期', () => {
    const source: ReportSource = { tasks: () => [], reports: () => [] };
    const list = listReportPeriods({ paths: env.paths, config: c, type: 'weekly', taskDates: [], today: '2026-10-22', source });
    expect(list.map((r) => r.id)).toEqual(['2026-W43']);
  });

  it('手動編輯：保留產生資訊並標為已編輯；沒有原報告時以來源版本建立', () => {
    const period = { start: '2026-10-05', end: '2026-10-11' };
    const now = new Date('2026-10-20T03:04:05.678Z');
    const existing = report({ sources_version: 'abc', stale: true });
    const e = editedReport({ paths: env.paths, type: 'weekly', id: '2026-W41', period, existing, content: '新內容', now });
    expect(e).toMatchObject({ prompt: 'weekly/default', sources_version: 'abc', generated_at: '2026-10-12T00:00:00Z', edited: true, stale: true, body: '新內容' });

    const source: ReportSource = { tasks: () => [], reports: () => [] };
    const n = editedReport({ paths: env.paths, type: 'weekly', id: '2026-W41', period, existing: null, content: 'x', now, source });
    expect(n).toMatchObject({ prompt: 'manual', prompt_hash: 'manual', generated_at: '2026-10-20T03:04:05Z', edited: true, stale: false });
    expect(n.sources_version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('績效的每週時數只算到今天', () => {
    const tasks = [
      { date: '2026-10-06', hours: 1.234 },
      { date: '2026-10-07', hours: 2 },
      { date: '2026-10-14', hours: 3 },
      { date: '2026-10-29', hours: 9 },
    ];
    expect(weeklyHours({ start: '2026-10-01', end: '2026-10-31' }, c, tasks, '2026-10-15')).toEqual([
      { id: '2026-W40', start: '2026-09-28', hours: 0 },
      { id: '2026-W41', start: '2026-10-05', hours: 3.23 },
      { id: '2026-W42', start: '2026-10-12', hours: 3 },
    ]);
  });
});

describe('專案清單', () => {
  it('附上任務數與父卡片標題（從單號或上層卡片找，不分大小寫）', () => {
    const config = Config.parse({
      projects: [
        { id: 'a', name: '專案 A', match: { parents: ['tdda-100', 'TDDA-200'] } },
        { id: 'b', name: '專案 B' },
      ],
    });
    const cache = {
      'TDDA-1': { key: 'TDDA-1', summary: '子卡', type: 'Story', fetched_at: '2026-10-01T00:00:00Z', ancestors: [{ key: 'TDDA-100', summary: '大型工作', type: 'Epic' }] },
      'TDDA-200': { key: 'TDDA-200', summary: '另一個 Epic', type: 'Epic', fetched_at: '2026-10-01T00:00:00Z', ancestors: [] },
    };
    const tasks = [{ project_id: 'a' }, { project_id: 'a' }, { project_id: undefined }];
    expect(projectRuleSummaries(config, tasks, cache)).toEqual([
      { id: 'a', name: '專案 A', task_count: 2, parents: [{ key: 'tdda-100', summary: '大型工作' }, { key: 'TDDA-200', summary: '另一個 Epic' }] },
      { id: 'b', name: '專案 B', task_count: 0, parents: [] },
    ]);
  });
});

describe('Jira 專案代碼', () => {
  it('加入時從忽略清單移除；忽略時不重複', () => {
    const t = { keys: ['TDDA'], ignored_keys: ['ABC'], other: 1 };
    expect(applyTicketKeyAction(t, 'ABC', 'add')).toEqual({ keys: ['TDDA', 'ABC'], ignored_keys: [], other: 1 });
    expect(applyTicketKeyAction(t, 'ABC', 'ignore').ignored_keys).toEqual(['ABC']);
    expect(applyTicketKeyAction(t, 'TDDA', 'add').keys).toEqual(['TDDA']);
  });

  it('找出分支、標題或 commit 提到該代碼單號的任務，不誤認較長的代碼', () => {
    const tasks = [
      { id: 1, branch: 'feature/ABC-12', title: '', commits: [] },
      { id: 2, branch: 'main', title: '修 ABC-3', commits: [] },
      { id: 3, branch: 'main', title: '', commits: [{ message: 'fix: ABC-9 修正' }] },
      { id: 4, branch: 'XABC-1', title: 'ABC 無單號', commits: [] },
    ];
    expect(tasksMentioningKey(tasks, 'ABC').map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe('小交流', () => {
  const talk = (o: Partial<TalkRecord>): TalkRecord => ({
    schema: 1,
    type: 'talk',
    title: '標題',
    dates: ['2026-10-06'],
    prompt: 'talk/default',
    prompt_hash: 'h',
    sources: [],
    stats: {},
    created_at: '2026-10-06T10:00:00+08:00',
    edited: false,
    body: '內容',
    id: '2026-10-06-1000',
    path: '',
    version: 'v',
    ...o,
  });

  it('狀態', () => {
    expect(talkStatus(talk({ body: '  ' }), true)).toBe('none');
    expect(talkStatus(talk({}), true)).toBe('stale');
    expect(talkStatus(talk({ edited: true }), false)).toBe('edited');
    expect(talkStatus(talk({}), false)).toBe('generated');
  });

  it('編輯：只有內容變動才標為已編輯；日期排序去重、標題去空白', () => {
    expect(applyTalkEdit(talk({}), { title: ' 新標題 ' })).toMatchObject({ title: '新標題', edited: false });
    expect(applyTalkEdit(talk({}), { content: '內容' }).edited).toBe(false);
    expect(applyTalkEdit(talk({}), { content: '改過' })).toMatchObject({ body: '改過', edited: true });
    expect(applyTalkEdit(talk({}), { dates: ['2026-10-08', '2026-10-07', '2026-10-08'] }).dates).toEqual(['2026-10-07', '2026-10-08']);
  });

  it('從垃圾桶檔名還原 id', () => {
    expect(talkIdFromTrash('C:\\x\\.worktrail\\trash\\1700000000000__talk__2026-10-06-1000.md')).toBe('2026-10-06-1000');
    expect(talkIdFromTrash('/x/trash/1700000000000__talk__2026-10-06-1000-2.md')).toBe('2026-10-06-1000-2');
  });
});

describe('範本', () => {
  it('預設範本清單與刪除檢查', () => {
    const config = Config.parse({ report: { weekly: { default_prompt: 'weekly/mine' } } });
    expect(defaultPromptRefs(config)).toEqual({ summary: 'summary/default', weekly: 'weekly/mine', performance: 'performance/default', talk: 'talk/default' });
    expect(promptDeleteError(config, 'weekly/mine')).toContain('預設範本');
    expect(promptDeleteError(config, 'weekly/default')).toBeNull();
    expect(promptDeleteError(config, 'weekly/other')).toBeNull();
  });
});
