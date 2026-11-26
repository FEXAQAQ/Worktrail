import { describe, expect, it } from 'vitest';
import { parseConfigEmail, parseGitLog } from '../src/core/capture/git.js';
import { addDays, localDate, startOfLocalDay, toIsoInTz } from '../src/core/capture/tz.js';
import { parseConfig } from '../src/core/config/load.js';
import { Config, defaultConfig, Item, TaskFrontmatter, taskId } from '../src/core/schema/index.js';

describe('Config', () => {
  it('空物件得到完整預設值', () => {
    const c = defaultConfig();
    expect(c.capture.guard).toBe('commit');
    expect(c.time).toEqual({ timezone: 'Asia/Taipei', idle_threshold_minutes: 15, idle_grace_minutes: 2, rounding: 0.5, daily_hours: 8 });
    expect(c.ticket.keys).toEqual(['TDDA']);
    expect(c.report.weekly.start_day).toBe('monday');
    expect(c.ui.port).toBe(4870);
    expect(c.ui.style).toBe('default');
  });

  it('介面風格只接受 default / notebook', () => {
    expect(Config.parse({ ui: { style: 'notebook' } }).ui.style).toBe('notebook');
    expect(Config.safeParse({ ui: { style: 'retro' } }).success).toBe(false);
  });

  it('部分設定與預設值合併', () => {
    const c = Config.parse({ time: { idle_threshold_minutes: 20 }, projects: [{ name: 'X' }] });
    expect(c.time.idle_threshold_minutes).toBe(20);
    expect(c.time.idle_grace_minutes).toBe(2);
    expect(c.projects[0]!.match).toEqual({ paths: [], ticket_keys: [], parents: [] });
  });

  it('YAML 語法錯誤時改用預設值並回報行號', () => {
    const r = parseConfig('user_name: Leo\ncapture:\n  guard: [commit\n');
    expect(r.error).toBeDefined();
    expect(r.error!.line).toBeGreaterThan(0);
    expect(r.config).toEqual(defaultConfig());
  });

  it('欄位值錯誤時回報路徑與行號', () => {
    const r = parseConfig('user_name: Leo\ncapture:\n  guard: sometimes\n');
    expect(r.error?.message).toContain('capture.guard');
    expect(r.error?.line).toBe(3);
    expect(r.config.user_name).toBe('');
  });

  it('正確的設定檔', () => {
    const r = parseConfig('user_name: Leo\nticket:\n  keys: [TDDA, BMS]\n');
    expect(r.error).toBeUndefined();
    expect(r.config.ticket.keys).toEqual(['TDDA', 'BMS']);
    expect(parseConfig('').config).toEqual(defaultConfig());
  });
});

describe('Task schema', () => {
  it('skipped 與 blocked 必須有 note', () => {
    expect(Item.safeParse({ text: 'x', status: 'skipped' }).success).toBe(false);
    expect(Item.safeParse({ text: 'x', status: 'blocked', note: '等待 DBA' }).success).toBe(true);
    expect(Item.safeParse({ text: 'x', status: 'done' }).success).toBe(true);
    expect(Item.safeParse({ text: '', status: 'done' }).success).toBe(false);
    expect(Item.safeParse({ text: 'x'.repeat(201), status: 'done' }).success).toBe(false);
  });

  it('任務檔前段 YAML 預設值與時間格式', () => {
    const t = TaskFrontmatter.parse({
      schema: 1,
      id: 'x',
      session_id: 's',
      date: '2026-11-12',
      first_activity: '2026-11-12T09:40:12+08:00',
    });
    expect(t).toMatchObject({ ticket: null, items: [], summary_status: 'draft', hours_overridden: false, locked_fields: [] });
    expect(TaskFrontmatter.safeParse({ schema: 1, id: 'x', session_id: 's', date: '2026-11-12', first_activity: '2026-11-12 09:40' }).success).toBe(false);
  });

  it('taskId 格式', () => {
    expect(taskId('2026-11-12', 'TDDA-1869', 'a1b2c3d4-5678')).toBe('2026-11-12__TDDA-1869__a1b2c3');
    expect(taskId('2026-11-12', null, 'a1b2c3d4')).toBe('2026-11-12__no-ticket__a1b2c3');
  });
});

describe('tz', () => {
  it('localDate / toIsoInTz / startOfLocalDay', () => {
    const ts = Date.parse('2026-11-12T16:30:00Z');
    expect(localDate(ts, 'Asia/Taipei')).toBe('2026-11-13');
    expect(toIsoInTz(ts, 'Asia/Taipei')).toBe('2026-11-13T00:30:00+08:00');
    expect(toIsoInTz(ts, 'UTC')).toBe('2026-11-12T16:30:00+00:00');
    expect(new Date(startOfLocalDay('2026-11-13', 'Asia/Taipei')).toISOString()).toBe('2026-11-12T16:00:00.000Z');
    // 日光節約時間交界（美東 2026-03-08 切換）
    expect(new Date(startOfLocalDay('2026-03-09', 'America/New_York')).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('parseGitLog', () => {
  it('解析分隔字元格式', () => {
    const out = '3f9a1c2\x1f2026-11-12T10:00:00+08:00\x1ffeat: 發送演練 API 規劃\x1e\n9b1\x1fbad\x1fx\x1e\n';
    expect(parseGitLog(out)).toEqual([
      { sha: '3f9a1c2', ts: Date.parse('2026-11-12T10:00:00+08:00'), message: 'feat: 發送演練 API 規劃' },
    ]);
  });

  it('含作者 email 的四欄格式', () => {
    const out = 'a1b2c3d\x1f2026-11-12T10:00:00+08:00\x1fLeo@Example.com\x1ffix: x\x1e';
    expect(parseGitLog(out)).toEqual([{ sha: 'a1b2c3d', ts: Date.parse('2026-11-12T10:00:00+08:00'), email: 'Leo@Example.com', message: 'fix: x' }]);
  });
});

describe('parseConfigEmail', () => {
  it('取 [user] 區段的 email，忽略註解與引號', () => {
    expect(parseConfigEmail('[core]\n\temail = no@x\n[user]\n\tname = Leo\n\temail = "leo@example.com" # 公司\n')).toBe('leo@example.com');
    expect(parseConfigEmail('[core]\n\tautocrlf = true\n')).toBeNull();
  });

  it('用了 include 時交給 git 判斷', () => {
    expect(parseConfigEmail('[includeIf "gitdir:~/work/"]\n\tpath = ~/.gitconfig-work\n')).toBe('include');
    expect(parseConfigEmail('[include]\n\tpath = other\n')).toBe('include');
  });
});

describe('ui.theme', () => {
  it('只有淺色、深色；舊設定的 system 視為淺色，未設定為淺色', async () => {
    const { Config } = await import('../src/core/schema/config.js');
    expect(Config.parse({}).ui.theme).toBe('light');
    expect(Config.parse({ ui: { theme: 'system' } }).ui.theme).toBe('light');
    expect(Config.parse({ ui: { theme: 'dark' } }).ui.theme).toBe('dark');
    expect(() => Config.parse({ ui: { theme: 'blue' } })).toThrow();
  });
});
