import { describe, expect, it } from 'vitest';
import { parseTranscript, userMessages } from '../src/core/transcript/index.js';
import { SID, assistantText, noise, thinking, toolResult, toolUse, tw, user } from './helpers.js';

describe('parseTranscript', () => {
  it('標準化 user / assistant / tool_use / tool_result 事件', () => {
    const { events, meta, badLines } = parseTranscript(
      [
        user(tw('09:00'), '請讀取 TDDA-1869 並開始開發'),
        toolUse(tw('09:01'), 't1', 'Bash', { command: 'ls' }),
        toolResult(tw('09:02'), 't1', [{ type: 'text', text: 'file.cs' }]),
        assistantText(tw('09:03'), '完成'),
      ].join('\n'),
    );
    expect(badLines).toBe(0);
    expect(events.map((e) => e.role)).toEqual(['user', 'tool_use', 'tool_result', 'assistant']);
    expect(events[1]).toMatchObject({ toolName: 'Bash', toolUseId: 't1', toolInput: { command: 'ls' } });
    expect(events[2]).toMatchObject({ toolUseId: 't1', text: 'file.cs' });
    expect(meta).toMatchObject({ sessionId: SID, cwd: 'D:\\repos\\se-platform', branches: ['feature/TDDA-1869'] });
  });

  it('忽略不認識的事件類型，不報錯', () => {
    const { events, badLines } = parseTranscript(
      [
        noise.apiRequest(tw('09:00')),
        noise.attachment(tw('09:00')),
        noise.costState(),
        JSON.stringify({ type: 'some-future-type', foo: 1 }),
        JSON.stringify([1, 2]),
        'null',
        user(tw('09:05'), 'hi'),
      ].join('\n'),
    );
    expect(badLines).toBe(0);
    expect(events).toHaveLength(1);
  });

  it('計算無法解析的行數', () => {
    const { badLines, events } = parseTranscript(`{not json\n${user(tw('09:00'), 'x')}\n\n`);
    expect(badLines).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('移除注入的 system-reminder，純注入的訊息不算使用者輸入', () => {
    const { events } = parseTranscript(
      [
        user(tw('09:00'), [
          { type: 'text', text: '<system-reminder>\nsecret context\n</system-reminder>' },
          { type: 'text', text: '開始 TDDA-1' },
        ]),
        user(tw('09:01'), '<system-reminder>only</system-reminder>'),
        user(tw('09:02'), 'meta', { isMeta: true }),
      ].join('\n'),
    );
    expect(userMessages(events).map((e) => e.text)).toEqual(['開始 TDDA-1']);
  });

  it('只有 thinking 的回應保留時間戳', () => {
    const { events } = parseTranscript(thinking(tw('09:00')));
    expect(events).toEqual([{ ts: Date.parse(tw('09:00')), role: 'assistant', sidechain: undefined }]);
  });

  it('讀取 custom-title、多個分支，並依時間排序', () => {
    const { events, meta } = parseTranscript(
      [
        user(tw('09:10'), 'second'),
        user(tw('09:00'), 'first', { gitBranch: 'develop' }),
        noise.customTitle('發送演練 API'),
        user(tw('09:20'), 'x', { gitBranch: 'HEAD' }),
      ].join('\n'),
    );
    expect(events.map((e) => e.text)).toEqual(['first', 'second', 'x']);
    expect(meta.customTitle).toBe('發送演練 API');
    expect(meta.branches).toEqual(['feature/TDDA-1869', 'develop']);
  });

  it('子代理事件標記 sidechain，不算使用者訊息', () => {
    const { events } = parseTranscript(user(tw('09:00'), 'sub prompt', { isSidechain: true }));
    expect(events[0]?.sidechain).toBe(true);
    expect(userMessages(events)).toHaveLength(0);
  });

  it('支援 CRLF 與字串型 tool_result 內容', () => {
    const { events } = parseTranscript([toolResult(tw('09:00'), 'a', 'plain text')].join('\r\n') + '\r\n');
    expect(events[0]).toMatchObject({ role: 'tool_result', text: 'plain text' });
  });
});
