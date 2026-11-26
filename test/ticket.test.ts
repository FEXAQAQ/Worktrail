import { describe, expect, it } from 'vitest';
import { extractTickets, isJiraTool, scoreTickets } from '../src/core/capture/ticket.js';
import type { TranscriptEvent } from '../src/core/transcript/index.js';

const keys = ['TDDA', 'BMS'];
let t = 0;
const u = (text: string): TranscriptEvent => ({ ts: ++t, role: 'user', text });
const a = (text: string): TranscriptEvent => ({ ts: ++t, role: 'assistant', text });
const jira = (input: unknown, name = 'mcp__atlassian-rovo-mcp__getJiraIssue'): TranscriptEvent => ({
  ts: ++t,
  role: 'tool_use',
  toolName: name,
  toolInput: input,
  toolUseId: `j${t}`,
});

describe('extractTickets', () => {
  it('只接受白名單代碼，排除 UTF-8、SHA-256', () => {
    expect(extractTickets('UTF-8 與 SHA-256，處理 TDDA-1869 和 BMS-12，忽略 ABC-1', keys)).toEqual(['TDDA-1869', 'BMS-12']);
  });

  it('支援分支名稱中的各種分隔', () => {
    expect(extractTickets('fix/TDDA-1931-TDDA-1945', keys)).toEqual(['TDDA-1931', 'TDDA-1945']);
    expect(extractTickets('feature/TDDA-1869_dkim', keys)).toEqual(['TDDA-1869']);
    expect(extractTickets('xTDDA-1 TDDA-12a TDDA-123', keys)).toEqual(['TDDA-12', 'TDDA-123']);
  });

  it('不接受小寫代碼', () => {
    expect(extractTickets('tdda-1869', keys)).toEqual([]);
  });
});

describe('isJiraTool', () => {
  it('名稱含 jira 或 atlassian', () => {
    expect(isJiraTool('mcp__atlassian-rovo-mcp__getJiraIssue')).toBe(true);
    expect(isJiraTool('mcp__jira__get_issue')).toBe(true);
    expect(isJiraTool('Bash')).toBe(false);
    expect(isJiraTool(undefined)).toBe(false);
  });
});

describe('scoreTickets', () => {
  it('依出現位置計分', () => {
    const r = scoreTickets({
      events: [
        u('請讀取 TDDA-1869 開發，TDDA-1869 很急'), // 第一則：+5（同一則只算一次）
        jira({ issueIdOrKey: 'TDDA-1869' }), // +5
        u('順便看 TDDA-1900'), // +1
        u('TDDA-1900 還有問題'), // +1
      ],
      branches: ['feature/TDDA-1869'], // +4
      commitMessages: ['feat: TDDA-1869 發送演練 API', 'fix: TDDA-1900'], // +3, +3
      keys,
    });
    expect(r.ticket).toBe('TDDA-1869');
    expect(r.scores.find((s) => s.ticket === 'TDDA-1869')!.score).toBe(17);
    expect(r.scores.find((s) => s.ticket === 'TDDA-1900')!.score).toBe(5);
    expect(r.related).toEqual(['TDDA-1900']);
  });

  it('Claude 回應每次 0.5 分，上限 3 分', () => {
    const r = scoreTickets({
      events: [u('開始'), ...Array.from({ length: 10 }, () => a('處理 BMS-7'))],
      branches: [],
      commitMessages: [],
      keys,
    });
    expect(r.scores[0]).toMatchObject({ ticket: 'BMS-7', score: 3 });
    // 只出現在 Claude 回應中的單號不列為主單號
    expect(r.ticket).toBeNull();
    expect(r.related).toEqual([]);
  });

  it('使用者訊息或分支有出現時，Claude 回應的分數照常累計', () => {
    const r = scoreTickets({ events: [u('看一下 BMS-7'), a('BMS-7 已處理'), a('另外 TDDA-9 也要注意')], branches: [], commitMessages: [], keys });
    expect(r.ticket).toBe('BMS-7');
    expect(r.scores.find((s) => s.ticket === 'BMS-7')!.score).toBe(5.5);
  });

  it('同分時取最早出現者', () => {
    const r = scoreTickets({
      events: [u('TDDA-2 與 TDDA-1')],
      branches: [],
      commitMessages: [],
      keys,
    });
    // 同一則訊息內同時出現，以進入計分表的順序為準
    expect(r.ticket).toBe('TDDA-2');
    expect(r.related).toEqual(['TDDA-1']);

    const r2 = scoreTickets({
      events: [u('先看看'), u('TDDA-5'), u('TDDA-6')],
      branches: [],
      commitMessages: [],
      keys,
    });
    expect(r2.ticket).toBe('TDDA-5');
    expect(r2.related).toEqual([]); // 1 分未達 3 分
  });

  it('沒有候選時 ticket 為 null', () => {
    expect(scoreTickets({ events: [u('hello UTF-8')], branches: ['main'], commitMessages: [], keys })).toMatchObject({
      ticket: null,
      related: [],
    });
  });

  it('分支有兩個單號時兩者都得分；第一則訊息決定主單號', () => {
    const r = scoreTickets({
      events: [u('處理 TDDA-1945')],
      branches: ['fix/TDDA-1931-TDDA-1945'],
      commitMessages: [],
      keys,
    });
    expect(r.ticket).toBe('TDDA-1945');
    expect(r.related).toEqual(['TDDA-1931']);
  });

  it('子代理的使用者訊息不算第一則訊息', () => {
    const r = scoreTickets({
      events: [{ ts: 0, role: 'user', text: 'TDDA-9', sidechain: true }, u('TDDA-10')],
      branches: [],
      commitMessages: [],
      keys,
    });
    expect(r.ticket).toBe('TDDA-10');
  });
});
