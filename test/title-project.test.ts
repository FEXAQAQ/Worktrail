import { describe, expect, it } from 'vitest';
import { globToRegExp, matchPath, normalizePath, resolveProject } from '../src/core/capture/project.js';
import { findJiraSummary, pickTitle } from '../src/core/capture/title.js';
import type { TranscriptEvent } from '../src/core/transcript/index.js';
import { assignProjectIds, ProjectRule } from '../src/core/schema/config.js';

describe('findJiraSummary', () => {
  it('從巢狀 JSON 與 MCP text 包裝中找出 summary', () => {
    expect(findJiraSummary(JSON.stringify({ key: 'TDDA-1', fields: { summary: '[BE] 發送演練 API' } }))).toBe('[BE] 發送演練 API');
    const wrapped = JSON.stringify([{ type: 'text', text: JSON.stringify({ fields: { summary: '包裝內' } }) }]);
    expect(findJiraSummary(wrapped)).toBe('包裝內');
  });

  it('非 JSON 時以正規表示式擷取', () => {
    expect(findJiraSummary('prefix {"summary": "含 \\"引號\\" 的標題", broken')).toBe('含 "引號" 的標題');
    expect(findJiraSummary('no summary here')).toBeUndefined();
  });
});

describe('pickTitle', () => {
  const events: TranscriptEvent[] = [
    { ts: 1, role: 'user', text: '請讀取 TDDA-1869 並開始開發，這是一段很長很長的說明文字，用來測試標題截斷是否正確運作，超過六十個字元的部分應該被截掉才對喔喔喔喔' },
    { ts: 2, role: 'tool_use', toolName: 'mcp__atlassian-rovo-mcp__getJiraIssue', toolUseId: 'x', toolInput: { issueIdOrKey: 'TDDA-1' } },
    { ts: 3, role: 'tool_result', toolUseId: 'x', text: JSON.stringify({ fields: { summary: '其他單' } }) },
    { ts: 4, role: 'tool_use', toolName: 'mcp__atlassian-rovo-mcp__getJiraIssue', toolUseId: 'y', toolInput: { issueIdOrKey: 'TDDA-1869' } },
    { ts: 5, role: 'tool_result', toolUseId: 'y', text: JSON.stringify({ fields: { summary: '[BE] 發送演練 API + DB規劃' } }) },
  ];

  it('摘要標題優先', () => {
    expect(pickTitle({ events, ticket: 'TDDA-1869', summaryTitle: '自訂' })).toEqual({ title: '自訂', source: 'summary' });
  });

  it('其次為與單號相符的 Jira summary', () => {
    expect(pickTitle({ events, ticket: 'TDDA-1869', customTitle: 'x' })).toEqual({ title: '[BE] 發送演練 API + DB規劃', source: 'jira' });
    expect(pickTitle({ events, ticket: 'TDDA-9' })?.title).toBe('其他單');
  });

  it('再其次為 Desktop 對話標題，最後為第一則訊息前 60 字', () => {
    const noJira = events.slice(0, 1);
    expect(pickTitle({ events: noJira, ticket: null, customTitle: '對話標題' })).toEqual({ title: '對話標題', source: 'custom_title' });
    const r = pickTitle({ events: noJira, ticket: null });
    expect(r?.source).toBe('first_user_message');
    expect([...r!.title].length).toBe(61); // 60 字 + 省略號
  });

  it('沒有任何候選時為 null', () => {
    expect(pickTitle({ events: [], ticket: null })).toBeNull();
  });
});

describe('project', () => {
  const rules = assignProjectIds([
    ProjectRule.parse({ name: '社交工程', match: { paths: ['D:/repos/se-*'] } }),
    ProjectRule.parse({ name: 'BMS', match: { ticket_keys: ['BMS'] } }),
    ProjectRule.parse({ name: '社交工程-2', match: { ticket_keys: ['TDDA'] } }),
  ]);

  it('normalizePath', () => {
    expect(normalizePath('c:\\proj\\se-webapi\\')).toBe('C:/proj/se-webapi');
    if (process.platform === 'win32') expect(normalizePath('/c/proj/x')).toBe('C:/proj/x');
    expect(normalizePath('/home/me/x/')).toBe('/home/me/x');
  });

  it('glob：* 單層、** 多層、包含子資料夾、Windows 不分大小寫', () => {
    expect(matchPath('D:\\repos\\se-platform', 'D:/repos/se-*')).toBe(true);
    expect(matchPath('d:\\Repos\\SE-platform\\sub', 'D:/repos/se-*')).toBe(true);
    expect(matchPath('D:\\repos\\bms', 'D:/repos/se-*')).toBe(false);
    expect(matchPath('D:\\personal\\a\\b', 'D:/personal/**')).toBe(true);
    expect(matchPath('D:\\personal', 'D:/personal/**')).toBe(true);
    expect(globToRegExp('/srv/?.txt', false).test('/srv/b.txt')).toBe(true);
    expect(globToRegExp('/srv/**/x', false).test('/srv/x')).toBe(true);
    expect(globToRegExp('/srv/**/x', false).test('/srv/a/b/x')).toBe(true);
  });

  it('路徑規則優先於單號規則', () => {
    expect(resolveProject({ cwd: 'D:\\repos\\se-platform', ticket: 'BMS-1', rules })).toEqual({
      project: '社交工程',
      project_id: rules[0]!.id,
      unmapped: false,
      rule: 'path',
    });
    expect(resolveProject({ cwd: 'C:\\proj\\bms-web', ticket: 'BMS-1', rules })).toMatchObject({ project: 'BMS', rule: 'ticket_key' });
  });

  it('都不符合時使用資料夾名稱並標示未對應', () => {
    expect(resolveProject({ cwd: 'C:\\proj\\cloudforce-aware', ticket: null, rules })).toEqual({
      project: 'cloudforce-aware',
      unmapped: true,
    });
    expect(resolveProject({ cwd: undefined, ticket: null, rules: [] })).toEqual({ project: '', unmapped: true });
  });
});
