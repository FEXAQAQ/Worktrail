import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate } from '../src/core/capture/tz.js';
import { weekOf } from '../src/core/period/index.js';
import { readTask, writeTask } from '../src/core/storage/tasks.js';
import { emptyTask } from '../src/core/sync/merge.js';
import { createDaemon } from '../src/daemon/server.js';
import { makeEnv, type TestEnv } from './env.js';

const PORT = 4999;
const TOKEN = 'test-token';

describe('常駐服務 HTTP API', () => {
  let env: TestEnv;
  let daemon: ReturnType<typeof createDaemon>;
  const today = localDate(Date.now(), 'Asia/Taipei');
  const week = weekOf(today, 'monday');

  const call = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await daemon.app.inject({
      method: method as 'GET',
      url,
      payload: payload as object,
      headers: { host: `localhost:${PORT}`, authorization: `Bearer ${TOKEN}`, ...headers },
    });
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {}, raw: r.body };
  };

  beforeAll(() => {
    env = makeEnv();
    const t = emptyTask('aaaabbbb-0000-4000-8000-000000000001', today);
    writeTask(env.paths, {
      ...t,
      id: `${today}__TDDA-1869__aaaabb`,
      ticket: 'TDDA-1869',
      project: '社交工程',
      title: '[BE] 發送演練 API',
      active_minutes: 125,
      hours: 2,
      items: [
        { text: '完成 API', status: 'done' },
        { text: '等待 DBA', status: 'blocked', note: '權限申請中' },
      ],
      summary_status: 'done',
    });
    const uiDir = join(env.dir, 'ui');
    mkdirSync(join(uiDir, 'assets'), { recursive: true });
    writeFileSync(join(uiDir, 'index.html'), '<!doctype html><html><head><title>W</title></head><body></body></html>');
    writeFileSync(join(uiDir, 'assets', 'app.js'), 'console.log(1)');
    daemon = createDaemon({ paths: env.paths, port: PORT, token: TOKEN, uiDir, watch: false, checkLogin: false });
  });
  afterAll(async () => {
    await daemon.stop();
    env.cleanup();
  });

  it('安全：Host 不符回 403，沒有 token 回 401', async () => {
    expect((await call('GET', '/api/tasks', undefined, { host: 'evil.com' })).status).toBe(403);
    expect((await call('GET', '/api/tasks', undefined, { authorization: '' })).status).toBe(401);
    expect((await call('GET', '/api/ping')).status).toBe(200);
  });

  it('UI：注入 token、SPA fallback、靜態資源', async () => {
    const r = await daemon.app.inject({ method: 'GET', url: '/log', headers: { host: `127.0.0.1:${PORT}` } });
    expect(r.body).toContain(`"token":"${TOKEN}"`);
    const js = await daemon.app.inject({ method: 'GET', url: '/assets/app.js', headers: { host: `localhost:${PORT}` } });
    expect(js.headers['content-type']).toContain('javascript');
  });

  it('查詢與修改任務：鎖定欄位、時數來源、版本衝突', async () => {
    const list = await call('GET', `/api/tasks?from=${today}&to=${today}`);
    expect(list.body.tasks).toHaveLength(1);
    const t = list.body.tasks[0];

    const patched = await call('PATCH', `/api/tasks/${t.id}`, { base_version: t.version, hours: 3.5, project: '社交工程-後端' });
    expect(patched.status).toBe(200);
    expect(patched.body.task).toMatchObject({ hours: 3.5, hours_overridden: true, hours_source: 'user', locked_fields: ['project'] });

    const stale = await call('PATCH', `/api/tasks/${t.id}`, { base_version: t.version, title: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.data.task.hours).toBe(3.5);

    // 改單號 → 檔名與 id 跟著改
    const renamed = await call('PATCH', `/api/tasks/${t.id}`, { base_version: patched.body.task.version, ticket: 'TDDA-2000' });
    expect(renamed.body.task.id).toBe(`${today}__TDDA-2000__aaaabb`);
    expect(readTask(renamed.body.task.path)?.locked_fields).toEqual(['project', 'ticket']);

    // 還原為系統計算值
    const reset = await call('PATCH', `/api/tasks/${renamed.body.task.id}`, { base_version: renamed.body.task.version, hours: null });
    expect(reset.body.task).toMatchObject({ hours: 2, hours_source: 'computed', hours_overridden: false });
  });

  it('刪除後可復原', async () => {
    const { body } = await call('GET', '/api/tasks');
    const id = body.tasks[0].id;
    const del = await call('DELETE', `/api/tasks/${id}`);
    expect((await call('GET', `/api/tasks/${id}`)).status).toBe(404);
    const restored = await call('POST', '/api/tasks/restore', { trash_path: del.body.trash_path });
    expect(restored.body.task.id).toBe(id);
    expect((await call('POST', '/api/tasks/restore', { trash_path: 'C:\\Windows\\x' })).status).toBe(400);
  });

  it('統計數字', async () => {
    const { body } = await call('GET', `/api/stats?from=${today}&to=${today}`);
    expect(body.stats).toMatchObject({ task_count: 1, completion_rate: 0.5 });
  });

  it('週報：清單、讀取（含即時統計）、手動編輯、編輯後產生需確認', async () => {
    const list = await call('GET', '/api/reports?type=weekly');
    expect(list.body.reports[0]).toMatchObject({ status: 'none', task_count: 1, period: week });
    const id = list.body.reports[0].id;

    const get = await call('GET', `/api/reports/weekly/${id}`);
    expect(get.body.report).toBeNull();
    expect(get.body.stats.task_count).toBe(1);

    const put = await call('PUT', `/api/reports/weekly/${id}`, { content: '# 我手寫的週報' });
    expect(put.body.report.edited).toBe(true);
    const list2 = await call('GET', '/api/reports?type=weekly');
    expect(list2.body.reports[0].status).toBe('edited');

    const gen = await call('POST', `/api/reports/weekly/${id}/generate`, {});
    expect(gen.status).toBe(409);
    expect(gen.body.data.needs_overwrite).toBe(true);

    const prep = await call('POST', `/api/reports/weekly/${id}/prepare`, {});
    expect(prep.body.rendered_prompt).toContain('TDDA-');
  });

  it('範本：清單、儲存驗證、試跑（含未儲存內文）、刪除', async () => {
    const list = await call('GET', '/api/prompts');
    expect(list.body.prompts.some((p: { ref: string; builtin: boolean }) => p.ref === 'weekly/builtin' && p.builtin)).toBe(true);

    const bad = await call('PUT', '/api/prompts/weekly/short', { text: '---\nname: 短\ntype: weekly\n---\n沒有紀錄變數' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('{{records}}');

    const ok = await call('PUT', '/api/prompts/weekly/short', { text: '---\nname: 短週報\ntype: weekly\n---\n期間 {{period}}\n{{records}}\n{{unknown_var}}' });
    expect(ok.status).toBe(200);
    expect(ok.body.validation.warnings[0]).toContain('unknown_var');

    const render = await call('POST', '/api/prompts/weekly/short/render', {});
    expect(render.body.rendered).toContain(`期間 ${week.start} ～ ${week.end}`);
    expect(render.body.rendered).toContain('{{unknown_var}}');

    const draft = await call('POST', '/api/prompts/weekly/short/render', { text: '---\nname: x\ntype: weekly\n---\n草稿 {{period_start}} {{records}}' });
    expect(draft.body.rendered).toContain(`草稿 ${week.start}`);

    expect((await call('PUT', '/api/prompts/weekly/builtin', { text: 'x' })).status).toBe(400);
    expect((await call('DELETE', '/api/prompts/weekly/short')).status).toBe(200);
  });

  it('設定：讀取、儲存、驗證失敗', async () => {
    const get = await call('GET', '/api/config');
    expect(get.body.config.ui.port).toBe(4870);
    const cfg = { ...get.body.config, user_name: '測試者', ticket: { keys: ['TDDA', 'BMS'] } };
    const put = await call('PUT', '/api/config', { config: cfg });
    expect(put.status).toBe(200);
    expect((await call('GET', '/api/config')).body.raw).toContain('# Worktrail 設定檔');
    const bad = await call('PUT', '/api/config', { config: { ...cfg, capture: { ...cfg.capture, guard: 'never' } } });
    expect(bad.status).toBe(400);
  });

  it('手動新增任務：不需要對話紀錄、不可補寫摘要、出現在專案清單與統計', async () => {
    expect((await call('POST', '/api/tasks', { date: today, title: '' })).status).toBe(400);
    const r = await call('POST', '/api/tasks', { date: today, title: '週會：DKIM 網域討論', project: '會議', ticket: 'tdda-1869', hours: 1.5 });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({
      manual: true,
      ticket: 'TDDA-1869',
      hours: 1.5,
      hours_source: 'user',
      summary_status: 'done',
      locked_fields: ['project', 'ticket'],
    });
    expect(readTask(r.body.task.path)?.manual).toBe(true);
    expect((await call('POST', `/api/tasks/${r.body.task.id}/summarize`)).status).toBe(400);

    const patched = await call('PATCH', `/api/tasks/${r.body.task.id}`, { base_version: r.body.task.version, items: [{ text: '確認 DKIM 網域', status: 'done' }] });
    expect(patched.body.task.items).toHaveLength(1);

    // 從 Jira 整理：已有子項需確認取代；沒有單號或非手動任務不可用
    const jira = await call('POST', `/api/tasks/${patched.body.task.id}/jira-summarize`, {});
    expect(jira.status).toBe(409);
    expect(jira.body.data.needs_overwrite).toBe(true);
    const noTicket = await call('POST', '/api/tasks', { date: today, title: '支援' });
    expect((await call('POST', `/api/tasks/${noTicket.body.task.id}/jira-summarize`, {})).status).toBe(400);
    const tasks = await call('GET', `/api/tasks?from=${today}&to=${today}`);
    const captured = tasks.body.tasks.find((t: { manual?: boolean }) => !t.manual);
    expect((await call('POST', `/api/tasks/${captured.id}/jira-summarize`, {})).status).toBe(400);
    await call('DELETE', `/api/tasks/${noTicket.body.task.id}`);

    const projects = await call('GET', '/api/projects');
    expect(projects.body.projects).toEqual(expect.arrayContaining(['會議']));
    const stats = await call('GET', `/api/stats?from=${today}&to=${today}`);
    expect(stats.body.stats.hours_by_project.some((p: { project: string }) => p.project === '會議')).toBe(true);
  });

  it('合併同一天的任務：標記並鎖定專案、統計算一筆、可取消', async () => {
    const a = await call('POST', '/api/tasks', { date: today, title: '寫測試', project: '社交工程', hours: 1 });
    const b = await call('POST', '/api/tasks', { date: today, title: '查 log', project: '', hours: 0.5 });
    const other = await call('POST', '/api/tasks', { date: '2026-01-02', title: '別天', project: '社交工程' });
    expect((await call('POST', '/api/tasks/merge', { ids: [a.body.task.id], project: '社交工程' })).status).toBe(400);
    expect((await call('POST', '/api/tasks/merge', { ids: [a.body.task.id, other.body.task.id], project: '社交工程' })).status).toBe(400);

    const before = (await call('GET', `/api/stats?from=${today}&to=${today}`)).body.stats.task_count;
    const m = await call('POST', '/api/tasks/merge', { ids: [a.body.task.id, b.body.task.id], project: '社交工程' });
    expect(m.status).toBe(200);
    expect(m.body.tasks.map((t: { merged: boolean; project: string }) => [t.merged, t.project])).toEqual([
      [true, '社交工程'],
      [true, '社交工程'],
    ]);
    expect(readTask(m.body.tasks[1].path)?.locked_fields).toContain('project');
    expect((await call('GET', `/api/stats?from=${today}&to=${today}`)).body.stats.task_count).toBe(before - 1);

    const u = await call('POST', '/api/tasks/unmerge', { ids: m.body.tasks.map((t: { id: string }) => t.id) });
    expect(u.body.tasks.every((t: { merged?: boolean }) => !t.merged)).toBe(true);
    for (const t of [...u.body.tasks, other.body.task]) await call('DELETE', `/api/tasks/${t.id}`);
  });

  it('專案：設定改名同步任務、合併專案、任務數', async () => {
    const cfg0 = (await call('GET', '/api/config')).body.config;
    const put = await call('PUT', '/api/config', { config: { ...cfg0, projects: [{ id: 'se', name: '社交工程' }, { id: 'mt', name: '會議' }] } });
    expect(put.status).toBe(200);
    const a = await call('POST', '/api/tasks', { date: today, title: '專案測試 A', project: '社交工程', hours: 1 });
    const b = await call('POST', '/api/tasks', { date: today, title: '專案測試 B', project: '會議', hours: 1 });
    expect(a.body.task.project_id).toBe('se');

    const renamed = await call('PUT', '/api/config', { config: { ...put.body.config, projects: [{ id: 'se', name: '社交工程演練' }, { id: 'mt', name: '會議' }] } });
    expect(renamed.body.projects_updated).toBeGreaterThanOrEqual(1);
    expect((await call('GET', `/api/tasks/${a.body.task.id}`)).body.task.project).toBe('社交工程演練');
    expect(readTask(a.body.task.path)?.project).toBe('社交工程演練');

    const merged = await call('POST', '/api/projects/merge', { from: 'mt', to: 'se' });
    expect(merged.status).toBe(200);
    expect(merged.body.config.projects.map((p: { id: string }) => p.id)).toEqual(['se']);
    expect((await call('GET', `/api/tasks/${b.body.task.id}`)).body.task).toMatchObject({ project: '社交工程演練', project_id: 'se' });
    const rules = (await call('GET', '/api/projects')).body.rules;
    expect(rules).toEqual([{ id: 'se', name: '社交工程演練', task_count: expect.any(Number), parents: [] }]);
    expect(rules[0].task_count).toBeGreaterThanOrEqual(2);
    expect((await call('POST', '/api/projects/merge', { from: 'se', to: 'se' })).status).toBe(400);

    for (const t of [a, b]) await call('DELETE', `/api/tasks/${t.body.task.id}`);
    await call('PUT', '/api/config', { config: { ...merged.body.config, projects: [] } });
  });

  it('搜尋與 health', async () => {
    const s = await call('GET', '/api/search?q=DBA');
    expect(s.body.tasks).toHaveLength(1);
    const h = await call('GET', '/api/health');
    expect(h.body.storage_root).toBe(env.storage);
    expect(Array.isArray(h.body.checks)).toBe(true);
  });
});
