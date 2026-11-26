import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findCallingSession } from '../src/core/sync/locate.js';
import { missingCarryOver } from '../src/core/summary/index.js';
import { pendingToolUses } from '../src/core/transcript/index.js';
import { toolResult, toolUse, user } from './helpers.js';
import { makeEnv, writeTranscript, type TestEnv } from './env.js';

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const SAVE = 'mcp__worktrail__worklog_save_summary';

describe('找出呼叫 MCP 工具的對話', () => {
  let env: TestEnv;
  const cwd = 'C:\proj\se-webapi';
  beforeAll(() => {
    env = makeEnv();
  });
  afterAll(() => env.cleanup());

  it('pendingToolUses 只回傳尚未回覆的呼叫，忽略被截斷的第一行', () => {
    const lines = [toolUse(iso(3), 'a', SAVE, {}), toolResult(iso(2), 'a', 'ok'), toolUse(iso(1), 'b', SAVE, {})];
    const content = '{"truncated": ' + '\n' + lines.join('\n');
    expect(pendingToolUses(content).map((p) => p.name)).toEqual([SAVE]);
    expect(pendingToolUses(lines.slice(0, 2).join('\n'))).toEqual([]);
  });

  it('同一個資料夾有多個對話時，選出正在呼叫的那一個（磁碟代號大小寫不同也可以）', () => {
    writeTranscript(env, cwd, 'sess-a', [user(iso(5), '一'), toolUse(iso(4), 'x', SAVE, {}), toolResult(iso(4), 'x', 'ok')]);
    writeTranscript(env, cwd, 'sess-b', [user(iso(3), '二'), toolUse(iso(0), 'y', SAVE, {})]);
    writeTranscript(env, cwd, 'sess-c', [user(iso(1), '三'), toolUse(iso(0), 'z', 'mcp__worktrail__worklog_get_task', {})]);
    expect(findCallingSession(cwd, 'worklog_save_summary')).toBe('sess-b');
    expect(findCallingSession('c:\proj\se-webapi', 'worklog_save_summary')).toBe('sess-b');
    expect(findCallingSession(cwd, 'worklog_get_task')).toBe('sess-c');
    expect(findCallingSession(cwd, 'worklog_list_tasks')).toBeNull();
    expect(findCallingSession('C:\nowhere', 'worklog_save_summary')).toBeNull();
  });

  it('太久以前沒有回覆的呼叫（例如對話中斷）不算', () => {
    writeTranscript(env, 'C:\old', 'sess-old', [toolUse(iso(30), 'o', SAVE, {})]);
    expect(findCallingSession('C:\old', 'worklog_save_summary')).toBeNull();
  });

  it('missingCarryOver 以去除空白後的文字比對', () => {
    const prev = [
      { text: '整理 API 文件', status: 'pending' as const },
      { text: '補單元測試', status: 'todo' as const },
    ];
    expect(missingCarryOver(prev, [{ text: '整理 API文件' }]).map((i) => i.text)).toEqual(['補單元測試']);
  });
});
