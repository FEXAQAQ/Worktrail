import { describe, expect, it } from 'vitest';
import { applyTicketKeySelection, normalizeTicketKeys, previewPeriods, ticketKeyChoices } from '../src/core/onboarding/index.js';
import { parseConfig } from '../src/core/config/load.js';
import { Config, defaultConfig } from '../src/core/schema/config.js';
import { DEFAULT_CONFIG_YAML } from '../src/core/storage/config-store.js';

const task = (branch: string, title = '', ticket: string | null = null, commits: string[] = []) => ({
  branch,
  title,
  ticket,
  commits: commits.map((message) => ({ message })),
});

describe('首次引導狀態', () => {
  it('新建立的設定檔為 pending；舊設定檔沒有欄位時視為 done', () => {
    expect(parseConfig(DEFAULT_CONFIG_YAML).config.ui.onboarding).toBe('pending');
    expect(parseConfig('user_name: Leo\nui:\n  theme: dark\n').config.ui.onboarding).toBe('done');
    expect(defaultConfig().ui.onboarding).toBe('done');
  });
});

describe('ticketKeyChoices', () => {
  it('偵測到的新代碼預先勾選；設定中近期沒出現的代碼不勾', () => {
    const tasks = [task('feature/BMS-12_login'), task('fix/BMS-30'), task('main', 'SHOP-1 修正')];
    const r = ticketKeyChoices(tasks, ['TDDA']);
    expect(r.choices.map((c) => [c.key, c.current, c.tasks])).toEqual([
      ['TDDA', true, 0],
      ['BMS', false, 2],
    ]);
    expect(r.choices[1]!.example?.source).toBe('branch');
    expect(r.selected).toEqual(['BMS']);
  });

  it('設定中的代碼近期有出現（含已辨識的單號）就保留勾選', () => {
    const tasks = [task('main', '', 'TDDA-1869'), task('feature/BMS-1')];
    const r = ticketKeyChoices(tasks, ['TDDA']);
    expect(r.choices[0]).toMatchObject({ key: 'TDDA', tasks: 1 });
    expect(r.selected).toEqual(['TDDA', 'BMS']);
  });

  it('近期沒有任何代碼時保留設定中的代碼', () => {
    expect(ticketKeyChoices([], ['TDDA']).selected).toEqual(['TDDA']);
  });

  it('忽略清單中的代碼不列出', () => {
    const r = ticketKeyChoices([task('feature/BMS-1')], ['TDDA'], ['BMS']);
    expect(r.choices.map((c) => c.key)).toEqual(['TDDA']);
  });
});

describe('applyTicketKeySelection', () => {
  const ticket = { keys: ['TDDA'], ignored_keys: ['FOO'], fetch_parents: true };

  it('勾選的成為代碼；沒勾的偵測代碼列入忽略；原有代碼只移除', () => {
    const r = applyTicketKeySelection(ticket, ['bms', 'SHOP-'], ['TDDA', 'BMS', 'SHOP', 'ABC']);
    expect(r.ticket).toEqual({ keys: ['BMS', 'SHOP'], ignored_keys: ['FOO', 'ABC'], fetch_parents: true });
    expect(r.changed).toEqual(['BMS', 'SHOP', 'TDDA']);
  });

  it('勾選曾被忽略的代碼時移出忽略清單', () => {
    const r = applyTicketKeySelection(ticket, ['TDDA', 'FOO'], []);
    expect(r.ticket.keys).toEqual(['TDDA', 'FOO']);
    expect(r.ticket.ignored_keys).toEqual([]);
    expect(r.changed).toEqual(['FOO']);
  });

  it('全部不勾：不使用 Jira', () => {
    expect(applyTicketKeySelection(ticket, [], ['TDDA']).ticket.keys).toEqual([]);
  });
});

describe('normalizeTicketKeys', () => {
  it('轉大寫、去尾端連字號、去重，略過不合格式的', () => {
    expect(normalizeTicketKeys([' bms ', 'BMS', 'shop-', '1ABC', 'A', 'X9'])).toEqual(['BMS', 'SHOP', 'X9']);
  });
});

describe('previewPeriods', () => {
  it('預設：ISO 週與季', () => {
    const r = previewPeriods(defaultConfig(), '2026-11-20');
    expect(r.weekly).toEqual({ start: '2026-11-16', end: '2026-11-22', id: '2026-W47' });
    expect(r.performance).toEqual({ start: '2026-10-01', end: '2026-12-31', id: '2026-Q4' });
  });

  it('雙週報、考核年度 7 月起、半年績效', () => {
    const c = Config.parse({
      report: { weekly: { length_weeks: 2, anchor_date: '2026-11-09' }, performance: { period: 'half_yearly', year_start_month: 7 } },
    });
    const r = previewPeriods(c, '2026-11-20');
    expect(r.weekly).toMatchObject({ start: '2026-11-09', end: '2026-11-22' });
    expect(r.performance).toEqual({ start: '2026-07-01', end: '2026-12-31', id: 'FY2026-H1' });
  });

  it('自訂績效期間沒有本期', () => {
    const c = Config.parse({ report: { performance: { period: 'custom' } } });
    expect(previewPeriods(c, '2026-11-20').performance).toBeNull();
  });
});
