import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listPrompts, loadPrompt, validatePrompt } from '../src/core/prompt/index.js';
import { Config } from '../src/core/schema/config.js';
import type { Task } from '../src/core/schema/task.js';
import { writeTask } from '../src/core/storage/tasks.js';
import { emptyTask } from '../src/core/sync/merge.js';
import {
  createTalk,
  formatDates,
  getTalk,
  isTalkStale,
  listTalks,
  newTalkId,
  normalizeDates,
  prepareTalk,
  saveGeneratedTalk,
  TalkConflictError,
  writeTalk,
} from '../src/core/talk/index.js';
import { createDaemon } from '../src/daemon/server.js';
import { makeEnv, type TestEnv } from './env.js';

const cfg = Config.parse({ user_name: '小明' });
const task = (o: Partial<Task>): Task => ({ ...emptyTask(`s-${Math.random()}`, o.date ?? '2026-11-10'), summary_status: 'done', ...o });

describe('小交流：核心', () => {
  let env: TestEnv;
  beforeAll(() => {
    env = makeEnv();
    writeTask(env.paths, task({ date: '2026-11-10', id: '2026-11-10__TDDA-1__aaaaaa', ticket: 'TDDA-1', title: '發送演練 API', hours: 3, items: [{ text: '完成 API', status: 'done' }] }));
    writeTask(env.paths, task({ date: '2026-11-11', id: '2026-11-11__TDDA-2__bbbbbb', ticket: 'TDDA-2', title: '不該出現', hours: 5, items: [{ text: '隔天的事', status: 'done' }] }));
    writeTask(env.paths, task({ date: '2026-11-12', id: '2026-11-12__TDDA-1__cccccc', ticket: 'TDDA-1', title: '發送演練 API', hours: 2, items: [{ text: '等 DBA', status: 'blocked', note: '權限申請中' }] }));
  });
  afterAll(() => env.cleanup());

  it('內建範本：talk/default 可載入、通過驗證，安裝時也複製一份', () => {
    const p = loadPrompt(env.paths, 'talk/default');
    expect(p.type).toBe('talk');
    expect(validatePrompt('talk/x', p.text).errors).toEqual([]);
    expect(validatePrompt('talk/x', '---\nname: x\n---\n沒有紀錄').errors[0]).toContain('{{records}}');
    expect(listPrompts(env.paths).some((x) => x.ref === 'talk/builtin')).toBe(true);
    expect(existsSync(env.paths.promptFile('talk', 'default'))).toBe(true);
    expect(cfg.report.talk.default_prompt).toBe('talk/default');
  });

  it('日期：排序去重、格式化（跨年時加年份）', () => {
    expect(normalizeDates(['2026-11-12', '2026-11-10', '2026-11-12'])).toEqual(['2026-11-10', '2026-11-12']);
    expect(() => normalizeDates(['2026/11/12'])).toThrow();
    expect(formatDates(['2026-11-10', '2026-11-12'])).toBe('11/10（二）、11/12（四）');
    expect(formatDates(['2026-12-31', '2027-01-04'])).toBe('2026/12/31（四）、2027/1/4（一）');
  });

  it('prepare 只納入勾選的日期（不連續），並填入口語範本', () => {
    const p = prepareTalk({ paths: env.paths, config: cfg, dates: ['2026-11-12', '2026-11-10'], today: '2026-11-16' });
    expect(p.dates).toEqual(['2026-11-10', '2026-11-12']);
    expect(p.sources).toEqual(['2026-11-10__TDDA-1__aaaaaa', '2026-11-12__TDDA-1__cccccc']);
    expect(p.stats.total_hours).toBe(5);
    expect(p.rendered_prompt).toContain('發送演練 API');
    expect(p.rendered_prompt).not.toContain('不該出現');
    expect(p.rendered_prompt).toContain('11/10（二）、11/12（四）');
    expect(p.rendered_prompt).toContain('小明');
    expect(p.rendered_prompt).toContain('一眼就能看懂');
    expect(p.prompt_name).toBe('talk/default');
    expect(() => prepareTalk({ paths: env.paths, config: cfg, dates: [], today: '2026-11-16' })).toThrow('至少勾選一天');
    expect(() => prepareTalk({ paths: env.paths, config: cfg, dates: ['2026-11-10'], prompt: 'weekly/default', today: '2026-11-16' })).toThrow('不是小交流');
    const empty = prepareTalk({ paths: env.paths, config: cfg, dates: ['2026-11-10', '2026-11-14'], today: '2026-11-16' });
    expect(empty.warnings.join()).toContain('11/14（六） 沒有任務紀錄');
  });

  it('自訂範本與試跑未儲存的內容', () => {
    const p = prepareTalk({
      paths: env.paths,
      config: cfg,
      dates: ['2026-11-10'],
      prompt: 'talk/english',
      templateText: '---\nname: 英文\ntype: talk\n---\nSpeak casually about {{dates}}:\n{{records}}',
      today: '2026-11-16',
    });
    expect(p.rendered_prompt).toMatch(/^Speak casually about 11\/10（二）:/);
  });

  it('建立、產生、過期偵測、上一次的內容', () => {
    const now = Date.parse('2026-11-16T06:30:00Z'); // 台北 14:30
    const t = createTalk(env.paths, cfg, { dates: ['2026-11-10'], now });
    expect(t.id).toBe('2026-11-16-1430');
    expect(newTalkId(env.paths, now, 'Asia/Taipei')).toBe('2026-11-16-1430-2');
    expect(isTalkStale(env.paths, t)).toBe(false);

    const p = prepareTalk({ paths: env.paths, config: cfg, dates: t.dates, excludeId: t.id, today: '2026-11-16' });
    const saved = saveGeneratedTalk({ paths: env.paths, config: cfg, id: t.id, prepared: p, content: '# 小交流\n大家好，這幾天我主要在忙…', now });
    expect(saved.body).toContain('大家好');
    expect(saved.generated_at).toBe('2026-11-16T14:30:00+08:00');
    expect(isTalkStale(env.paths, saved)).toBe(false);

    // 改勾選日期 → 過期
    const moved = writeTalk(env.paths, { ...saved, dates: ['2026-11-10', '2026-11-12'] });
    expect(isTalkStale(env.paths, moved)).toBe(true);
    const back = writeTalk(env.paths, { ...moved, dates: ['2026-11-10'] });
    expect(isTalkStale(env.paths, back)).toBe(false);

    // 來源任務修改 → 過期
    writeTask(env.paths, task({ date: '2026-11-10', id: '2026-11-10__TDDA-1__aaaaaa', ticket: 'TDDA-1', title: '發送演練 API', hours: 4 }));
    expect(isTalkStale(env.paths, getTalk(env.paths, t.id)!)).toBe(true);

    // 下一次小交流以這份為「上一次」
    const next = prepareTalk({
      paths: env.paths,
      config: cfg,
      dates: ['2026-11-12'],
      prompt: 'talk/with-previous',
      templateText: '---\nname: x\ntype: talk\n---\n{{records}}\n上次：{{previous}}',
      today: '2026-11-16',
    });
    expect(next.rendered_prompt).toContain('大家好，這幾天我主要在忙');

    // 已手動編輯 → 需 overwrite
    writeTalk(env.paths, { ...getTalk(env.paths, t.id)!, edited: true });
    expect(() => saveGeneratedTalk({ paths: env.paths, config: cfg, id: t.id, prepared: p, content: 'x' })).toThrow(TalkConflictError);
    expect(saveGeneratedTalk({ paths: env.paths, config: cfg, id: t.id, prepared: p, content: 'x', overwrite: true }).edited).toBe(false);

    expect(listTalks(env.paths).map((x) => x.id)).toEqual(['2026-11-16-1430']);
  });

  it('忽略不合法的檔名與 id', () => {
    mkdirSync(env.paths.talk, { recursive: true });
    writeFileSync(join(env.paths.talk, 'notes.md'), '# 隨手筆記');
    expect(listTalks(env.paths).every((t) => t.id !== 'notes')).toBe(true);
    expect(getTalk(env.paths, '../config')).toBeNull();
  });
});

describe('小交流：HTTP API', () => {
  const PORT = 4998;
  const TOKEN = 'test-token';
  let env: TestEnv;
  let daemon: ReturnType<typeof createDaemon>;
  const call = async (method: string, url: string, payload?: unknown) => {
    const r = await daemon.app.inject({
      method: method as 'GET',
      url,
      payload: payload as object,
      headers: { host: `localhost:${PORT}`, authorization: `Bearer ${TOKEN}` },
    });
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
  };

  beforeAll(() => {
    env = makeEnv();
    writeTask(env.paths, task({ date: '2026-11-10', id: '2026-11-10__TDDA-1__aaaaaa', ticket: 'TDDA-1', title: '發送演練 API', hours: 3, items: [{ text: '完成 API', status: 'done' }] }));
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07']) {
      writeTask(env.paths, task({ date, id: `${date}__TDDA-9__dddddd`, ticket: 'TDDA-9', title: '舊的工作', hours: 1 }));
    }
    daemon = createDaemon({ paths: env.paths, port: PORT, token: TOKEN, uiDir: join(env.dir, 'ui'), watch: false });
  });
  afterAll(async () => {
    await daemon.stop();
    env.cleanup();
  });

  it('建立、讀取、編輯、刪除與復原', async () => {
    expect((await call('POST', '/api/talks', { dates: [] })).status).toBe(400);
    const created = await call('POST', '/api/talks', { dates: ['2026-11-10'], title: 'W46 小交流' });
    expect(created.status).toBe(200);
    const id = created.body.talk.id as string;

    const list = await call('GET', '/api/talks');
    expect(list.body.talks[0]).toMatchObject({ id, title: 'W46 小交流', dates: ['2026-11-10'], status: 'none' });

    const got = await call('GET', `/api/talks/${id}`);
    expect(got.body.stats.total_hours).toBe(3);

    const put = await call('PUT', `/api/talks/${id}`, { content: '大家好', base_version: got.body.talk.version });
    expect(put.body.talk).toMatchObject({ body: '大家好', edited: true });
    expect((await call('PUT', `/api/talks/${id}`, { content: 'x', base_version: got.body.talk.version })).status).toBe(409);
    const dates = await call('PUT', `/api/talks/${id}`, { dates: ['2026-11-12', '2026-11-10'] });
    expect(dates.body.talk.dates).toEqual(['2026-11-10', '2026-11-12']);

    // 已編輯：產生需確認覆蓋
    expect((await call('POST', `/api/talks/${id}/generate`, {})).status).toBe(409);

    const prep = await call('POST', `/api/talks/${id}/prepare`, {});
    expect(prep.body.rendered_prompt).toContain('發送演練 API');

    const render = await call('POST', '/api/prompts/talk/default/render', {});
    // 試跑預設用最近 5 個有紀錄的日子
    expect(render.body.rendered).toContain('11/10（二）');
    expect(render.body.rendered).not.toContain('10/1（四）');
    expect((await call('GET', '/api/prompts')).body.defaults.talk).toBe('talk/default');

    const removed = await call('DELETE', `/api/talks/${id}`);
    expect((await call('GET', `/api/talks/${id}`)).status).toBe(404);
    const restored = await call('POST', '/api/talks/restore', { trash_path: removed.body.trash_path });
    expect(restored.body.talk.id).toBe(id);
    expect(restored.body.talk.body.trim()).toBe('大家好');
    expect((await call('GET', '/api/talks/not-an-id')).status).toBe(404);
  });
});
