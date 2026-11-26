import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../src/core/capture/analyze.js';
import { activeSpans, attributeCommits, committedShas } from '../src/core/capture/commits.js';
import { defaultConfig } from '../src/core/schema/config.js';
import { parseTranscript, type TranscriptEvent } from '../src/core/transcript/index.js';
import { assistantText, toolResult, toolUse, tw, user } from './helpers.js';

const queue = (ts: string) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: ts });

describe('分叉對話', () => {
  // 原對話 11/10 09:00–09:30；11/11 10:00 分叉，複製歷史後繼續工作
  const fork = [
    queue(tw('10:00', '2026-11-11')),
    user(tw('09:00', '2026-11-10'), '處理 TDDA-1937'),
    assistantText(tw('09:30', '2026-11-10'), '完成'),
    user(tw('10:00', '2026-11-11'), '接著做'),
    assistantText(tw('10:10', '2026-11-11'), '好了'),
  ].join('\n');

  it('早於檔案建立時間的訊息標記為 copied', () => {
    const { events, meta } = parseTranscript(fork);
    expect(meta.createdTs).toBe(Date.parse(tw('10:00', '2026-11-11')));
    expect(events.map((e) => !!e.copied)).toEqual([true, true, false, false]);
  });

  it('複製的訊息不計入時數，但仍用於判斷單號', () => {
    const r = analyzeSession({ parsed: parseTranscript(fork), config: defaultConfig() });
    expect(r.days.map((d) => [d.date, d.active_minutes])).toEqual([['2026-11-11', 10]]);
    expect(r.ticket).toBe('TDDA-1937');
    expect(r.warnings.some((w) => w.includes('分叉'))).toBe(true);
  });

  it('一般對話沒有 copied 事件', () => {
    const { events } = parseTranscript([queue(tw('09:00')), user(tw('09:00'), 'x'), assistantText(tw('09:05'), 'y')].join('\n'));
    expect(events.some((e) => e.copied)).toBe(false);
  });
});

describe('commit 歸屬', () => {
  const at = (h: string) => Date.parse(tw(h));
  const commits = [
    { sha: 'aaaaaaa1', message: 'mine', ts: at('10:00') },
    { sha: 'bbbbbbb2', message: 'other session', ts: at('10:05') },
    { sha: 'ccccccc3', message: 'manual', ts: at('10:10') },
    { sha: 'ddddddd4', message: 'later', ts: at('15:00') },
  ];

  it('從 git commit 輸出擷取 sha', () => {
    const ev: TranscriptEvent[] = [
      { ts: 1, role: 'tool_result', text: '[feature/TDDA-1 aaaaaaa] feat: x\n 2 files changed' },
      { ts: 2, role: 'tool_result', text: '[main (root-commit) 1234abc] init' },
      { ts: 3, role: 'tool_result', text: '[feature/x eeeeeee] copied', copied: true },
      { ts: 4, role: 'tool_result', text: '[x fffffff] failed', isError: true },
      { ts: 5, role: 'assistant', text: '[x 9999999] not a tool result' },
    ];
    expect(committedShas(ev)).toEqual(['aaaaaaa', '1234abc']);
  });

  it('支援 git commit -q 之後接 git log --oneline -1 的輸出', () => {
    const use = (id: string, command: string): TranscriptEvent => ({ ts: 1, role: 'tool_use', toolName: 'Bash', toolUseId: id, toolInput: { command } });
    const res = (id: string, text: string): TranscriptEvent => ({ ts: 2, role: 'tool_result', toolUseId: id, text });
    const ev: TranscriptEvent[] = [
      use('a', 'git add x && git commit -q -F - <<EOF\nmsg\nEOF\ngit log --oneline -1'),
      res('a', "warning: in the working copy of 'x', LF will be replaced by CRLF\nbf2019fb refactor: 單一常數\n"),
      use('b', 'git log --oneline -5'), // 不是 commit 呼叫
      res('b', '1111111 old one\n2222222 old two'),
      use('c', 'git commit --dry-run && git log --oneline -1'),
      res('c', '3333333 not committed'),
      use('d', 'git -C /repo commit -q -m x && git log --oneline -3'),
      res('d', '4444444 new\n5555555 older'),
    ];
    expect(committedShas(ev)).toEqual(['bf2019fb', '4444444']);
  });

  it('有證據時只採用證據中的 commit', () => {
    expect(attributeCommits(commits, { evidence: ['aaaaaaa'], activeSpans: [] }).map((c) => c.message)).toEqual(['mine']);
  });

  it('沒有證據時排除別的對話認領的，並限定活動時段', () => {
    const r = attributeCommits(commits, {
      evidence: [],
      claimedElsewhere: ['bbbbbbb'],
      activeSpans: [{ start: at('09:00'), end: at('11:00') }],
    });
    expect(r.map((c) => c.message)).toEqual(['mine', 'manual']);
  });

  it('activeSpans 依間隔切段並延長結尾', () => {
    const ev = ['09:00', '09:10', '12:00'].map((h) => ({ ts: at(h), role: 'user' as const }));
    const min = 60_000;
    expect(activeSpans(ev, 15 * min, 5 * min)).toEqual([
      { start: at('09:00'), end: at('09:15') },
      { start: at('12:00'), end: at('12:05') },
    ]);
  });

  it('analyzeSession 以對話中的 git commit 輸出歸屬 commit', () => {
    const lines = [
      user(tw('09:50'), '開始 TDDA-1'),
      toolUse(tw('09:59'), 'g', 'Bash', { command: 'git commit -m mine' }),
      toolResult(tw('10:00'), 'g', '[feature/TDDA-1 aaaaaaa] mine\n 1 file changed'),
    ].join('\n');
    const r = analyzeSession({ parsed: parseTranscript(lines), config: defaultConfig(), commits });
    expect(r.days[0]!.commits).toEqual([{ sha: 'aaaaaaa1', message: 'mine' }]);
  });
});
