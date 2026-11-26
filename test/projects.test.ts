import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveProject } from '../src/core/capture/project.js';
import { parseConfig } from '../src/core/config/load.js';
import { assignProjectIds, Config, projectIdFromName, ProjectRule } from '../src/core/schema/config.js';
import type { Task } from '../src/core/schema/task.js';
import { loadConfig, saveConfig } from '../src/core/storage/config-store.js';
import { readTask, writeTask } from '../src/core/storage/tasks.js';
import { emptyTask, mergeCapture } from '../src/core/sync/merge.js';
import { createManualTask } from '../src/core/sync/manual.js';
import {
  applyResolvedProject,
  autoProjectRules,
  mergeProjectRules,
  reresolveProject,
  syncProjectName,
  syncTaskProjects,
  trackIgnoredParents,
  unmappedParents,
} from '../src/core/sync/projects.js';
import { applyTaskPatch } from '../src/core/sync/task-edit.js';
import { markMerged } from '../src/core/sync/task-merge.js';
import {
  parseTicketInfoOutput,
  readTicketCache,
  ticketsNeedingRefresh,
  updateTicketCache,
  type TicketInfo,
} from '../src/core/ticket-info/index.js';
import type { SessionDraft } from '../src/core/capture/analyze.js';
import { makeEnv, type TestEnv } from './env.js';

let n = 0;
const task = (o: Partial<Task>): Task => ({ ...emptyTask(`0000000${++n}-0000-4000-8000-000000000000`, '2026-11-17'), ...o });
const cfg = (projects: unknown[]) => Config.parse({ projects });
const info = (key: string, ancestors: [string, string][]): TicketInfo => ({
  key,
  summary: '',
  type: 'Story',
  ancestors: ancestors.map(([k, s]) => ({ key: k, summary: s, type: 'Epic' })),
  fetched_at: '2026-11-18T00:00:00Z',
});

describe('專案固定 ID', () => {
  it('未填 id 時由名稱產生，同名結果一致；已填 id 保留；重複時加序號', () => {
    const c = cfg([{ name: 'A' }, { id: 'keep', name: 'B' }, { name: 'A' }]);
    expect(c.projects.map((p) => p.id)).toEqual([projectIdFromName('A'), 'keep', `${projectIdFromName('A')}-2`]);
    expect(cfg([{ name: 'A' }]).projects[0]!.id).toBe(projectIdFromName('A'));
    // 已填的 ID 先保留，產生的 ID 避開它
    const rules = assignProjectIds([ProjectRule.parse({ name: 'X' }), ProjectRule.parse({ id: projectIdFromName('X'), name: 'Y' })]);
    expect(rules.map((r) => r.id)).toEqual([`${projectIdFromName('X')}-2`, projectIdFromName('X')]);
  });

  it('名稱空白或 ID 格式錯誤時設定驗證失敗', () => {
    expect(parseConfig('projects:\n  - name: "  "\n').error).toBeDefined();
    expect(parseConfig('projects:\n  - id: "a b"\n    name: A\n').error).toBeDefined();
  });

  it('改名：任務依 ID 換成新名稱；沒有 ID 但名稱相同的舊任務補上 ID', () => {
    const before = cfg([{ id: 'se', name: '社交工程' }]);
    const after = cfg([{ id: 'se', name: '社交工程演練' }]);
    const t = task({ project: '社交工程', project_id: 'se' });
    expect(syncProjectName(t, after)).toMatchObject({ project: '社交工程演練', project_id: 'se' });
    expect(syncProjectName({ ...t, project: '社交工程演練' }, after)).toBeNull();
    const legacy = task({ project: '社交工程', project_unmapped: true });
    expect(syncProjectName(legacy, before)).toMatchObject({ project: '社交工程', project_id: 'se', project_unmapped: undefined });
    // 自由輸入、沒有對應專案的名稱不變
    expect(syncProjectName(task({ project: '會議' }), before)).toBeNull();
  });

  it('合併專案：條件聯集、刪除來源；任務依 remap 歸到目標', () => {
    const c = cfg([
      { id: 'a', name: 'A', match: { paths: ['C:/a'], parents: ['TDDA-1'] } },
      { id: 'b', name: 'B', match: { paths: ['C:/b'] } },
    ]);
    const merged = mergeProjectRules(c.projects, 'a', 'b');
    expect(merged).toEqual([{ id: 'b', name: 'B', match: { paths: ['C:/b', 'C:/a'], ticket_keys: [], parents: ['TDDA-1'] } }]);
    expect(() => mergeProjectRules(c.projects, 'a', 'a')).toThrow();
    const t = task({ project: 'A', project_id: 'a' });
    expect(syncProjectName(t, { projects: merged }, { a: 'b' })).toMatchObject({ project: 'B', project_id: 'b' });
  });

  it('手動指定名稱：符合設定的專案時帶上 ID，自由輸入則清掉 ID', () => {
    const c = cfg([{ id: 'se', name: '社交工程' }]);
    const t = task({ project: '社交工程', project_id: 'se' });
    expect(applyTaskPatch(t, { project: '會議' }, c).task.project_id).toBeUndefined();
    expect(applyTaskPatch(task({}), { project: '社交工程' }, c).task).toMatchObject({ project_id: 'se', locked_fields: ['project'] });
    expect(createManualTask({ date: '2026-11-17', title: 'x', project: '社交工程' }, c).project_id).toBe('se');
    expect(markMerged(task({}), '社交工程', c).project_id).toBe('se');
  });

  it('自動判斷為未對應時，不覆蓋已對應到專案的任務；新任務照常套用', () => {
    const assigned = task({ project: '社交工程', project_id: 'se' });
    expect(applyResolvedProject(assigned, { project: 'se-webapi', unmapped: true }, false)).toBe(assigned);
    expect(applyResolvedProject(assigned, { project: 'BMS', project_id: 'bms', unmapped: false }, false)).toMatchObject({ project_id: 'bms' });
    expect(applyResolvedProject(task({}), { project: 'se-webapi', unmapped: true }, true)).toMatchObject({ project: 'se-webapi', project_unmapped: true });
    const locked = task({ project: '會議', locked_fields: ['project'] });
    expect(applyResolvedProject(locked, { project: 'BMS', project_id: 'bms', unmapped: false }, false)).toBe(locked);
  });

  it('擷取：草稿的專案 ID 寫入任務', () => {
    const draft = { session_id: 's', repo: 'C:/proj/se', branch: '', ticket: null, related_tickets: [], ticket_scores: [], project: '社交工程', project_id: 'se', project_unmapped: false, title: null, days: [], warnings: [] } satisfies SessionDraft;
    const day = { date: '2026-11-17', active_minutes: 30, hours: 0.5, first_activity: '2026-11-17T09:00:00+08:00', last_activity: '2026-11-17T09:30:00+08:00', commits: [] };
    const t = mergeCapture({ existing: null, draft, day, config: cfg([]) })!;
    expect(t).toMatchObject({ project: '社交工程', project_id: 'se' });
    const again = mergeCapture({ existing: t, draft: { ...draft, project: 'se', project_id: undefined, project_unmapped: true }, day, config: cfg([]) })!;
    expect(again).toMatchObject({ project: '社交工程', project_id: 'se' });
  });
});

describe('父卡片規則', () => {
  const c = cfg([
    { id: 'path', name: '路徑專案', match: { paths: ['C:/proj/se-*'] } },
    { id: 'epic', name: '演練平台', match: { parents: ['tdda-100'] } },
    { id: 'key', name: 'TDDA 雜項', match: { ticket_keys: ['TDDA'] } },
  ]);

  it('上層任一層符合 parents 時優先於路徑與單號代碼', () => {
    const i = info('TDDA-1', [['TDDA-50', 'Story'], ['TDDA-100', 'Epic 演練']]);
    expect(resolveProject({ cwd: 'C:/proj/se-web', ticket: 'TDDA-1', rules: c.projects, ticketInfo: i })).toMatchObject({ project: '演練平台', project_id: 'epic', rule: 'parent' });
    // 單號本身就是列出的卡片
    expect(resolveProject({ cwd: undefined, ticket: 'TDDA-100', rules: c.projects })).toMatchObject({ project_id: 'epic' });
    // 沒有快取時照舊：路徑 → 單號代碼
    expect(resolveProject({ cwd: 'C:/proj/se-web', ticket: 'TDDA-1', rules: c.projects })).toMatchObject({ project_id: 'path' });
    expect(resolveProject({ cwd: 'C:/other', ticket: 'TDDA-1', rules: c.projects })).toMatchObject({ project_id: 'key' });
  });

  it('都不符合時用最上層卡片的標題，標示未對應', () => {
    const i = info('BMS-1', [['BMS-9', '會員中心改版']]);
    expect(resolveProject({ cwd: 'C:/x/bms', ticket: 'BMS-1', rules: c.projects, ticketInfo: i })).toEqual({ project: '會員中心改版', unmapped: true });
  });

  it('父卡片查到後重新判斷：未鎖定的任務改到父卡片專案，鎖定與手動任務不動', () => {
    const cache = { 'TDDA-1': info('TDDA-1', [['TDDA-100', 'Epic']]) };
    const t = task({ ticket: 'TDDA-1', repo: 'C:/proj/se-web', project: '路徑專案', project_id: 'path' });
    expect(reresolveProject(t, c, cache)).toMatchObject({ project: '演練平台', project_id: 'epic' });
    expect(reresolveProject({ ...t, project: '演練平台', project_id: 'epic' }, c, cache)).toBeNull();
    expect(reresolveProject({ ...t, locked_fields: ['project'] }, c, cache)).toBeNull();
    expect(reresolveProject({ ...t, manual: true }, c, cache)).toBeNull();
  });

  it('未對應的最上層卡片清單', () => {
    const cache = {
      'BMS-1': info('BMS-1', [['BMS-9', '會員中心']]),
      'BMS-2': info('BMS-2', [['BMS-9', '會員中心']]),
      'TDDA-1': info('TDDA-1', [['TDDA-100', 'Epic']]),
    };
    const tasks = [task({ ticket: 'BMS-1' }), task({ ticket: 'BMS-2' }), task({ ticket: 'BMS-1' }), task({ ticket: 'TDDA-1' }), task({ ticket: null })];
    expect(unmappedParents(tasks, cache, c)).toEqual([{ key: 'BMS-9', summary: '會員中心', type: 'Epic', task_count: 3, tickets: ['BMS-1', 'BMS-2'] }]);
  });
});

describe('大型工作自動建立專案', () => {
  const cache = {
    'TDDA-1': info('TDDA-1', [['TDDA-100', '演練平台']]),
    'TDDA-2': info('TDDA-2', [['TDDA-200', 'ISMS 稽核']]),
    'TDDA-3': info('TDDA-3', [['TDDA-300', 'ISMS 稽核']]),
    'TDDA-4': info('TDDA-4', [['TDDA-400', '已刪除']]),
  };
  const tasks = ['TDDA-1', 'TDDA-2', 'TDDA-3', 'TDDA-4'].map((ticket) => task({ ticket }));

  it('每張沒有規則的大型工作建立一個專案；同名的併入同一個；忽略清單中的不建立', () => {
    const c = Config.parse({ projects: [{ id: 'old', name: '演練平台', match: { parents: ['TDDA-100'] } }], ticket: { ignored_parents: ['tdda-400'] } });
    const rules = autoProjectRules(tasks, cache, c)!;
    expect(rules.map((r) => [r.name, r.match.parents])).toEqual([
      ['演練平台', ['TDDA-100']],
      ['ISMS 稽核', ['TDDA-200', 'TDDA-300']],
    ]);
    expect(rules[0]!.id).toBe('old');
    expect(rules[1]!.id).toMatch(/^p_/);
    expect(autoProjectRules(tasks, cache, { ...c, projects: rules })).toBeNull();
  });

  it('名稱與既有專案相同時，把大型工作加到該專案', () => {
    const c = Config.parse({ projects: [{ id: 'isms', name: 'ISMS 稽核' }], ticket: { ignored_parents: ['TDDA-400', 'TDDA-100'] } });
    const rules = autoProjectRules(tasks, cache, c)!;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: 'isms', match: { parents: ['TDDA-200', 'TDDA-300'] } });
  });

  it('從專案拿掉的大型工作記入忽略清單，加回時移出', () => {
    const before = cfg([{ id: 'a', name: 'A', match: { parents: ['TDDA-1', 'TDDA-2'] } }]).projects;
    const after = cfg([{ id: 'a', name: 'A', match: { parents: ['TDDA-2', 'TDDA-9'] } }]).projects;
    expect(trackIgnoredParents(before, after, ['TDDA-9', 'X-1'])).toEqual(['TDDA-1', 'X-1']);
    // 合併後條件聯集，不會進忽略清單
    expect(trackIgnoredParents(before, cfg([{ id: 'b', name: 'B', match: { parents: ['TDDA-1', 'TDDA-2'] } }]).projects, [])).toEqual([]);
  });
});

describe('單號資訊快取', () => {
  let env: TestEnv;
  beforeEach(() => (env = makeEnv()));
  afterEach(() => env.cleanup());

  it('解析 claude -p 輸出：正規化單號、排除自己、缺漏的單號記為失敗', () => {
    const out = parseTicketInfoOutput(
      {
        tickets: [{ key: 'tdda-1', summary: 'S', type: 'Sub-task', ancestors: [{ key: 'TDDA-1', summary: '' }, { key: 'tdda-50', summary: 'Story' }] }],
        errors: [{ key: 'TDDA-3', error: '沒有權限' }],
      },
      ['TDDA-1', 'TDDA-2', 'TDDA-3'],
      '2026-11-18T00:00:00Z',
    );
    expect(out.find((o) => o.key === 'TDDA-1')).toMatchObject({ ancestors: [{ key: 'TDDA-50', summary: 'Story' }] });
    expect(out.find((o) => o.key === 'TDDA-2')?.error).toBeTruthy();
    expect(out.find((o) => o.key === 'TDDA-3')?.error).toBe('沒有權限');
  });

  it('需要重新查詢：沒有快取、過期、失敗超過重試時間', () => {
    const now = Date.parse('2026-11-18T00:00:00Z');
    const cache = {
      'AB-1': { ...info('AB-1', []), fetched_at: '2026-11-17T00:00:00Z' },
      'AB-2': { ...info('AB-2', []), fetched_at: '2026-11-01T00:00:00Z' },
      'AB-3': { ...info('AB-3', []), fetched_at: '2026-11-17T23:00:00Z', error: 'x' },
      'AB-4': { ...info('AB-4', []), fetched_at: '2026-11-17T00:00:00Z', error: 'x' },
    };
    expect(ticketsNeedingRefresh(['AB-1', 'AB-2', 'AB-3', 'AB-4', 'ab-5', 'AB-5', 'not a ticket'], cache, now)).toEqual(['AB-2', 'AB-4', 'AB-5']);
  });

  it('寫入快取；查詢失敗時保留先前成功的上層資料', async () => {
    await updateTicketCache(env.paths, [info('TDDA-1', [['TDDA-100', 'Epic']])]);
    await updateTicketCache(env.paths, [{ ...info('TDDA-1', []), error: '逾時', fetched_at: '2026-11-19T00:00:00Z' }]);
    expect(readTicketCache(env.paths)['TDDA-1']).toMatchObject({ error: '逾時', ancestors: [{ key: 'TDDA-100' }], fetched_at: '2026-11-19T00:00:00Z' });
  });
});

describe('專案同步（任務檔）', () => {
  let env: TestEnv;
  beforeEach(() => (env = makeEnv()));
  afterEach(() => env.cleanup());

  it('設定存檔會寫入 ID；改名後同步任務檔', async () => {
    await saveConfig(env.paths, { projects: [{ name: '社交工程', match: { paths: ['C:/se'] } }] });
    const id = loadConfig(env.paths).config.projects[0]!.id;
    expect(id).toBe(projectIdFromName('社交工程'));
    const t = writeTask(env.paths, task({ project: '社交工程' }));
    // 舊任務依名稱補上 ID
    let r = await syncTaskProjects(env.paths, loadConfig(env.paths).config, [t]);
    expect(r.written).toHaveLength(1);
    expect(readTask(t.path)).toMatchObject({ project_id: id });
    // 改名：ID 不變，任務名稱跟著改
    const renamed = await saveConfig(env.paths, { projects: [{ id, name: '社交工程演練', match: { paths: ['C:/se'] } }] });
    r = await syncTaskProjects(env.paths, renamed, [readTask(t.path)!]);
    expect(readTask(t.path)).toMatchObject({ project: '社交工程演練', project_id: id });
  });
});
