import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractJson, findClaude, runClaudePrint } from '../src/core/claude-cli/index.js';
import { localDate } from '../src/core/capture/tz.js';
import { Config, defaultConfig } from '../src/core/schema/config.js';
import { pruneLogs, recentErrors, writeLog } from '../src/core/storage/log.js';
import { readTask, writeTask } from '../src/core/storage/tasks.js';
import { evaluateGuard } from '../src/core/sync/guard.js';
import { findTranscriptPath, resolveSessionId } from '../src/core/sync/locate.js';
import { emptyTask } from '../src/core/sync/merge.js';
import { pendingSummaries, sweep } from '../src/core/sync/sweep.js';
import { applyTaskPatch } from '../src/core/sync/task-edit.js';
import { updateState } from '../src/core/storage/state.js';
import { summarizeTask } from '../src/daemon/actions.js';
import { assistantText, retarget, user } from './helpers.js';
import { makeEnv, writeTranscript, type TestEnv } from './env.js';

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

describe('補漏掃描、session 對應、claude -p', () => {
  let env: TestEnv;
  /** 工作目錄放在暫存資料夾（不存在、也不是 git 專案），避免碰到本機剛好存在的同名專案 */
  let proj: string;
  const today = localDate(Date.now(), 'Asia/Taipei');

  beforeAll(() => {
    env = makeEnv();
    proj = join(env.dir, 'proj', 'se-webapi');
    const oldProj = join(env.dir, 'proj', 'old');
    // 一個 30 分鐘的工作對話、一個 1 分鐘的簡短提問、一個 Worktrail 自己的 claude -p 紀錄
    writeTranscript(env, proj, 'sess-long-0001', retarget(
      [user(iso(40), '處理 TDDA-100 的 API'), assistantText(iso(30), '好'), user(iso(20), '繼續'), assistantText(iso(10), '完成')],
      proj, 'sess-long-0001',
    ));
    writeTranscript(env, proj, 'sess-short-001', retarget([user(iso(5), '這是什麼？'), assistantText(iso(4), '說明')], proj, 'sess-short-001'));
    const internalCwd = env.paths.claudeRuns;
    writeTranscript(env, internalCwd, 'sess-internal1', retarget([user(iso(30), 'x'), assistantText(iso(1), 'y')], internalCwd, 'sess-internal1'));
    // 很久以前的紀錄檔不在掃描範圍
    const old = writeTranscript(env, oldProj, 'sess-old-00001', retarget([user(iso(60 * 24 * 30), 'old')], oldProj, 'sess-old-00001'));
    const t = new Date(Date.now() - 30 * 86_400_000);
    utimesSync(old, t, t);
  });
  afterAll(() => env.cleanup());

  it('掃描近期紀錄檔：建立任務、略過簡短提問與內部執行、列出待補摘要', async () => {
    const r = await sweep({ paths: env.paths, config: defaultConfig() });
    // Worktrail 自己的 claude -p 資料夾在掃描階段就排除；超過 sweep_days 的不掃
    expect(r.scanned).toBe(2);
    expect(r.created).toHaveLength(1);
    expect(r.created[0]).toContain('TDDA-100');
    expect(r.pending.map((t) => t.ticket)).toEqual(['TDDA-100']);
    // 再掃一次：紀錄檔未變動，不重複擷取
    const again = await sweep({ paths: env.paths, config: defaultConfig() });
    expect(again.captured).toBe(0);
    expect(pendingSummaries(env.paths, defaultConfig())).toHaveLength(1);
  });

  it('session 對應：依工作目錄找唯一的近期 session；多個時要求帶 session_id', async () => {
    await updateState(env.paths, (s) => {
      s.sessions['sess-long-0001']!.last_activity_ts = Date.now();
      s.sessions['sess-short-001']!.last_activity_ts = Date.now() - 60 * 60_000; // 一小時前，不算近期
    });
    // 磁碟代號小寫、斜線方向不同也視為同一個工作目錄
    expect(resolveSessionId(env.paths, undefined, proj[0]!.toLowerCase() + proj.slice(1).replace(/\\/g, '/'))).toBe('sess-long-0001');
    await updateState(env.paths, (s) => {
      s.sessions['sess-short-001'] = { registered_at: new Date().toISOString(), cwd: proj, last_activity_ts: Date.now() };
    });
    expect(() => resolveSessionId(env.paths, undefined, proj)).toThrow(/2 個/);
    expect(() => resolveSessionId(env.paths, undefined, 'C:\\nowhere')).toThrow(/session_id/);
    expect(resolveSessionId(env.paths, 'given', 'C:\\nowhere')).toBe('given');
    expect(findTranscriptPath(env.paths, 'sess-short-001')).toContain('sess-short-001.jsonl');
    expect(findTranscriptPath(env.paths, 'nope')).toBeNull();
  });

  it('extractJson：容忍程式碼框與前後文字', () => {
    expect(extractJson('好的：\n```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: '}' } });
    expect(extractJson('前言 {"x":1} 後記')).toEqual({ x: 1 });
    expect(() => extractJson('沒有 JSON')).toThrow();
    expect(() => extractJson('{"x": 1')).toThrow();
  });

  it('以假的 claude CLI 跑完整的補寫摘要流程', async () => {
    if (process.platform !== 'win32') return;
    const bin = join(env.dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'fake.js'),
      `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        if(!process.argv.includes('-p')||process.env.WORKTRAIL_INTERNAL!=='1'){process.exit(3)}
        const ok=s.includes('TDDA-100')&&s.includes('只輸出一個 JSON');
        console.log('以下是摘要：\\n'+JSON.stringify({title:'[BE] TDDA-100 API',items:[{text:ok?'完成 API':'沒收到 prompt',status:'done'},{text:'部署',status:'blocked',note:'等環境'}],hours_estimate:1.2}));
      });`,
    );
    const claude = join(bin, 'claude.cmd');
    writeFileSync(claude, `@node "%~dp0fake.js" %*\r\n`);
    expect(await findClaude(claude)).toBe(claude);
    expect(await findClaude(join(bin, 'missing.exe'))).toBeNull();

    const out = await runClaudePrint({ claudePath: claude, prompt: 'TDDA-100 只輸出一個 JSON', cwd: env.paths.claudeRuns });
    expect(out).toContain('完成 API');

    const config = Config.parse({ claude_cli: { path: claude } });
    const task = (await import('../src/core/storage/tasks.js')).listTasks(env.paths, today, today).find((t) => t.ticket === 'TDDA-100')!;
    const progress: string[] = [];
    const r = await summarizeTask(env.paths, config, task, { signal: new AbortController().signal, progress: (m) => progress.push(m) });
    expect(r.items).toBe(2);
    const saved = readTask((await import('../src/core/storage/tasks.js')).findTaskFile(env.paths, today, 'sess-long-0001')!)!;
    expect(saved).toMatchObject({ summary_status: 'done', title: '[BE] TDDA-100 API', hours: 1, hours_source: 'ai', summary_prompt: 'summary/default' });
    expect(saved.items[0]!.text).toBe('完成 API');
    expect(progress.length).toBeGreaterThan(0);
  });
});

describe('把關（edits 模式）、任務編輯、執行紀錄', () => {
  let env: TestEnv;
  beforeAll(() => (env = makeEnv()));
  afterAll(() => env.cleanup());

  it('edits 模式：編輯次數達門檻才把關', () => {
    const config = Config.parse({ capture: { guard: 'edits', guard_edit_threshold: 3 } });
    const base = { config, stopHookActive: false, guarded: [] as string[] };
    expect(evaluateGuard({ ...base, current: { sha: '', edits: 2 }, atSummary: null }).block).toBe(false);
    expect(evaluateGuard({ ...base, current: { sha: '', edits: 5 }, atSummary: { sha: '', edits: 3 } }).block).toBe(false);
    const r = evaluateGuard({ ...base, current: { sha: '', edits: 6 }, atSummary: { sha: '', edits: 3 } });
    expect(r).toEqual({ block: true, fingerprint: ':6' });
    expect(evaluateGuard({ ...base, guarded: [':6'], current: { sha: '', edits: 6 }, atSummary: null }).block).toBe(false);
    expect(evaluateGuard({ ...base, config: Config.parse({ capture: { guard: 'off' } }), current: { sha: 'a', edits: 99 }, atSummary: null }).block).toBe(false);
  });

  it('任務編輯：解除鎖定、內文、摘要狀態、遮蔽', () => {
    const t = { ...emptyTask('s1', '2026-11-12'), locked_fields: ['project' as const, 'ticket' as const], active_minutes: 95 };
    const r = applyTaskPatch(t, { unlock: ['project'], body: 'token=abcdef123456', summary_status: 'stale' }, defaultConfig());
    expect(r.task.locked_fields).toEqual(['ticket']);
    expect(r.task.body).toBe('token=[已遮蔽]');
    expect(r.task.summary_status).toBe('stale');
    expect(r.warnings).toHaveLength(1);
    const items = applyTaskPatch(t, { items: [{ text: '做完', status: 'done' }] }, defaultConfig()).task;
    expect(items).toMatchObject({ summary_status: 'done', summary_prompt: 'none' });
    expect(applyTaskPatch(t, { hours: null }, defaultConfig()).task.hours).toBe(1.5);
    writeTask(env.paths, items);
  });

  it('執行紀錄：寫入、讀取最近錯誤、清除過期檔', () => {
    writeLog(env.paths, 'test', 'error', '壞了\n第二行');
    writeLog(env.paths, 'test', 'info', '正常');
    expect(recentErrors(env.paths).join()).toContain('壞了 ⏎ 第二行');
    writeFileSync(join(env.paths.logs, '2020-01-01.log'), 'old');
    pruneLogs(env.paths);
    expect(recentErrors(env.paths).some((l) => l.includes('old'))).toBe(false);
  });
});
