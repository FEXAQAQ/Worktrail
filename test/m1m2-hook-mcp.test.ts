import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate } from '../src/core/capture/tz.js';
import { hookEntry } from '../src/core/program.js';
import { readState } from '../src/core/storage/state.js';
import { findTaskFile, listTasks, readTask, writeTask } from '../src/core/storage/tasks.js';
import { emptyTask } from '../src/core/sync/merge.js';
import { runHook } from '../src/hook/run.js';
import { handlers, saveSummaryDescription, type ToolContext } from '../src/mcp/tools.js';
import { updateState } from '../src/core/storage/state.js';
import { assistantText, retarget, toolResult, toolUse, user } from './helpers.js';
import { makeEnv, makeRepo, writeTranscript, type TestEnv } from './env.js';

const SID = '5e55i0n0-aaaa-4bbb-8ccc-000000000001';
const TZ = 'Asia/Taipei';
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

describe('hook 與 MCP（暫存環境）', () => {
  let env: TestEnv;
  let repo: string;
  let sha: string;
  let transcript: string;
  let ctx: ToolContext;
  const today = () => localDate(Date.now(), TZ);

  beforeAll(() => {
    env = makeEnv();
    repo = join(env.dir, 'repos', 'se-platform');
    sha = makeRepo(repo, 'feat: TDDA-1869 發送演練 API', new Date(Date.now() - 5 * 60_000).toISOString());
    transcript = writeTranscript(
      env,
      repo,
      SID,
      retarget(
        [
          JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(40) }),
          user(iso(40), '請讀取 TDDA-1869 並開始開發'),
          toolUse(iso(39), 't1', 'Edit', { file_path: 'a.cs' }),
          toolResult(iso(38), 't1', 'ok'),
          assistantText(iso(30), '完成 API 規劃'),
          user(iso(20), '幫我 commit'),
          toolUse(iso(6), 'g1', 'Bash', { command: 'git commit -m "feat: TDDA-1869"' }),
          toolResult(iso(5), 'g1', `[feature/TDDA-1869 ${sha}] feat: TDDA-1869 發送演練 API\n 1 file changed`),
          assistantText(iso(4), '已 commit'),
        ],
        repo,
        SID,
      ),
    );
    ctx = { paths: env.paths, cwd: repo };
  });
  afterAll(() => env.cleanup());

  /** 測試在忙碌的機器上執行：放寬 hook 的時間上限，2 秒上限另由「打包後的 hook 實際執行」驗證 */
  const hook = (event: Parameters<typeof runHook>[0], input: string, e: NodeJS.ProcessEnv = process.env) => runHook(event, input, e, 30_000);

  const payload = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ session_id: SID, transcript_path: transcript, cwd: repo, stop_hook_active: false, ...extra });

  it('SessionStart 登記 session 並注入 session_id', async () => {
    const out = await hook('session-start', payload());
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout!).hookSpecificOutput.additionalContext).toBe(`[Worktrail] session_id=${SID}`);
    expect(readState(env.paths).sessions[SID]?.cwd).toBe(repo);
  });

  it('WORKTRAIL_INTERNAL=1 時完全跳過；錯誤的輸入也以 exit 0 結束', async () => {
    expect(await hook('stop', payload(), { ...process.env, WORKTRAIL_INTERNAL: '1' })).toEqual({ code: 0 });
    expect(findTaskFile(env.paths, today(), SID)).toBeNull();
    expect((await hook('stop', '{not json')).code).toBe(0);
    expect((await hook('stop', JSON.stringify({ session_id: 'x', transcript_path: join(env.dir, 'missing.jsonl') }))).code).toBe(0);
  });

  it('Stop 建立任務檔；有新 commit 且尚未摘要時把關一次', async () => {
    const first = await hook('stop', payload());
    expect(first.code).toBe(2);
    expect(first.stderr).toContain('worklog_save_summary');

    const task = readTask(findTaskFile(env.paths, today(), SID)!)!;
    expect(task).toMatchObject({ ticket: 'TDDA-1869', summary_status: 'draft', branch: 'feature/TDDA-1869' });
    expect(task.commits.map((c) => c.sha)).toEqual([sha]);
    expect(task.active_minutes).toBeGreaterThan(0);

    // 同一進展只把關一次；紀錄檔未變動時直接跳過
    expect((await hook('stop', payload())).code).toBe(0);
    // stop_hook_active 時不把關
    expect((await hook('stop', payload({ stop_hook_active: true }))).code).toBe(0);
  });

  it('MCP：取得摘要範本', async () => {
    const r = await handlers.worklog_get_summary_guide(ctx, { session_id: SID });
    expect(r.prompt_name).toBe('summary/default');
    expect(r.guide).toContain('TDDA-1869');
    expect(r.guide).toContain(`session_id：${SID}`);
    expect(r.guide).toContain(r.prompt_hash);
    expect(r.draft.commits).toHaveLength(1);
  });

  it('MCP：寫入摘要（省略 session_id 時以工作目錄對應），AI 粗估時數，遮蔽密鑰', async () => {
    const r = await handlers.worklog_save_summary(ctx, {
      title: '[BE] 發送演練 API + DB規劃',
      items: [
        { text: '完成發送演練 API 規劃', status: 'done' },
        { text: '設定 password=hunter2 的連線', status: 'done', note: '未 commit' },
        { text: '取得 DKIM 私鑰', status: 'blocked', note: '等待 SE 提供' },
      ],
      hours_estimate: 2.3,
      prompt_name: 'summary/default',
      prompt_hash: 'abc123',
    });
    expect(r.summary_status).toBe('done');
    expect(r.hours).toBe(2.5);
    expect(r.warnings.join()).toContain('密碼或金鑰');
    const t = readTask(r.file_path)!;
    expect(t.items[1]!.text).toContain('password=[已遮蔽]');
    expect(t).toMatchObject({ hours_source: 'ai', title_source: 'summary', summary_prompt: 'summary/default' });
    expect(readState(env.paths).sessions[SID]?.summary_progress?.sha).toBe(sha);
  });

  it('MCP：skipped 沒有 note 時拒絕', async () => {
    await expect(
      handlers.worklog_save_summary(ctx, { session_id: SID, items: [{ text: 'x', status: 'skipped' }] }),
    ).rejects.toThrow(/note/);
  });

  it('摘要後再次 Stop：擷取不覆寫摘要欄位與 AI 時數，也不再把關', async () => {
    const out = await hook('stop', payload({ transcript_path: transcript }));
    expect(out.code).toBe(0);
    // 強制重新擷取
    const { captureSession } = await import('../src/core/sync/capture-session.js');
    const { loadConfig } = await import('../src/core/storage/config-store.js');
    await captureSession({ paths: env.paths, config: loadConfig(env.paths).config, transcriptPath: transcript, force: true });
    const t = readTask(findTaskFile(env.paths, today(), SID)!)!;
    expect(t.items).toHaveLength(3);
    expect(t.title).toBe('[BE] 發送演練 API + DB規劃');
    expect(t.hours).toBe(2.5);
  });

  it('MCP：list_tasks、get_task（前次未完成項目改由 guide 與 save_summary 提供）', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const prev = emptyTask('prev-session-0001', localDate(yesterday.getTime(), TZ));
    writeTask(env.paths, {
      ...prev,
      ticket: 'TDDA-1869',
      id: `${prev.date}__TDDA-1869__prevse`,
      items: [
        { text: '前次完成', status: 'done' },
        { text: '前次待進行', status: 'pending' },
      ],
    });
    const guide = await handlers.worklog_get_summary_guide(ctx, { session_id: SID });
    expect(guide.previous_items.map((i) => i.text)).toEqual(['前次待進行']);

    const list = await handlers.worklog_list_tasks(ctx, { from: prev.date, to: today(), ticket: 'TDDA-1869' });
    expect(list.count).toBe(2);
    const one = await handlers.worklog_get_task(ctx, { session_id: SID });
    expect(one.items).toHaveLength(3);
  });

  it('MCP：週報 prepare／save 只帶 period_id 與內容，統計與來源由伺服器補上；手動編輯後需 overwrite', async () => {
    const p = await handlers.worklog_report_prepare(ctx, { type: 'weekly' });
    expect(p.rendered_prompt).toContain('TDDA-1869');
    expect(p.rendered_prompt).toContain('[完成] 完成發送演練 API 規劃');
    expect(p.stats.total_hours).toBeGreaterThan(0);
    expect(p.next_step).toContain(p.period_id);
    const saved = await handlers.worklog_report_save(ctx, { type: 'weekly', period_id: p.period_id, content: '# 週報\n\n- 重點' });
    expect(existsSync(saved.file_path)).toBe(true);
    const { getReport, writeReport } = await import('../src/core/report/store.js');
    const r = getReport(env.paths, 'weekly', saved.report_id)!;
    expect(r).toMatchObject({ prompt: 'weekly/default', period_start: p.period.start, period_end: p.period.end });
    expect(r.prompt_hash).toBeTruthy();
    expect(r.sources.length).toBeGreaterThan(0);
    expect((r.stats as { total_hours: number }).total_hours).toBe(p.stats.total_hours);
    // 模擬使用者編輯
    writeReport(env.paths, { ...r, edited: true });
    const again = { type: 'weekly' as const, period_id: p.period_id, content: 'x' };
    await expect(handlers.worklog_report_save(ctx, again)).rejects.toThrow(/overwrite/);
    await expect(handlers.worklog_report_save(ctx, { ...again, overwrite: true })).resolves.toBeTruthy();
    await expect(handlers.worklog_report_save(ctx, { type: 'weekly', period_id: 'nonsense', content: 'x' })).rejects.toThrow(/period_id/);
  });

  it('MCP：開啟 UI', async () => {
    const opened: number[] = [];
    const r = await handlers.worklog_open_ui({ ...ctx, openUi: async (port) => (opened.push(port), `http://localhost:${port}`) });
    expect(opened).toEqual([4870]);
    expect(r.ui_url).toBe('http://localhost:4870');
  });

  it('打包後的 hook 實際執行：2 秒內完成並以 exit 0 結束', () => {
    if (!existsSync(hookEntry())) return;
    const start = Date.now();
    const r = spawnSync(process.execPath, [hookEntry(), 'session-end'], {
      input: payload(),
      env: process.env,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(listTasks(env.paths, today(), today()).length).toBeGreaterThan(0);
  });

  it('不啟動 git 即可讀出 HEAD；HEAD 未變時沿用快取', async () => {
    const { readHeadSha } = await import('../src/core/capture/git.js');
    const full = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(readHeadSha(repo)).toBe(full);
    expect(readHeadSha(join(repo, 'sub', 'dir'))).toBe(full);
    expect(readHeadSha(env.dir)).toBeNull();
    execFileSync('git', ['-C', repo, 'pack-refs', '--all']);
    expect(readHeadSha(repo)).toBe(full);
    const cache = readState(env.paths).sessions[SID]?.git_cache;
    expect(cache?.head).toBe(full);
    expect(cache?.commits.map((c) => c.sha)).toEqual([sha]);
  });

  it('MCP：同資料夾有兩個對話時，從紀錄檔找出呼叫端；未帶範本時以預設範本記錄；提示遺漏的前次項目', async () => {
    const SID2 = '5e55i0n0-aaaa-4bbb-8ccc-000000000002';
    writeTranscript(env, repo, SID2, retarget([user(iso(2), '另一個對話')], repo, SID2));
    await updateState(env.paths, (s) => {
      s.sessions[SID]!.last_activity_ts = Date.now();
      s.sessions[SID2] = { registered_at: new Date().toISOString(), cwd: repo, last_activity_ts: Date.now() };
    });
    // Claude Code 執行工具前就把 tool_use 寫入紀錄檔
    appendFileSync(transcript, retarget([toolUse(iso(0), 'm1', 'mcp__worktrail__worklog_save_summary', {})], repo, SID)[0] + '\n');
    const items = [
      { text: '完成發送演練 API 規劃', status: 'done' as const },
      { text: '設定連線', status: 'done' as const },
      { text: '取得 DKIM 私鑰', status: 'blocked' as const, note: '等待 SE 提供' },
    ];
    const r = await handlers.worklog_save_summary(ctx, { items });
    const t = readTask(r.file_path)!;
    expect(t.session_id).toBe(SID);
    expect(t.summary_prompt).toBe('summary/default');
    expect(t.summary_prompt_hash).toBeTruthy();
    expect(r.previous_open_items?.map((i) => i.text)).toEqual(['前次待進行']);
    expect(r.next_step).toContain('worklog_save_summary');

    const r2 = await handlers.worklog_save_summary(ctx, { items: [...items, { text: '前次 待進行', status: 'pending' }] });
    expect(r2.previous_open_items).toBeUndefined();
  });

  it('worklog_save_summary 的說明附上預設範本的撰寫規則', () => {
    const d = saveSummaryDescription(env.paths);
    expect(d).toContain('撰寫規則');
    expect(d).toContain('子項數量 3–10 項');
    expect(d).not.toContain('{{');
  });

  it('git 指令可用（測試前提）', () => {
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toContain('git');
    expect(readFileSync(transcript, 'utf8')).toContain(SID);
  });
});
