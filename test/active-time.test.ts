import { describe, expect, it } from 'vitest';
import { computeActiveTime, roundHours, type ActiveTimeOptions } from '../src/core/capture/active-time.js';
import type { TranscriptEvent } from '../src/core/transcript/index.js';

const opts: ActiveTimeOptions = { timezone: 'Asia/Taipei', idleThresholdMinutes: 15, idleGraceMinutes: 2 };
const at = (hhmm: string, date = '2026-11-12') => Date.parse(`${date}T${hhmm}:00+08:00`);
const ev = (hhmm: string, role: TranscriptEvent['role'] = 'user', extra: Partial<TranscriptEvent> = {}, date?: string) =>
  ({ ts: at(hhmm, date), role, ...extra }) as TranscriptEvent;

describe('computeActiveTime', () => {
  it('間隔不超過門檻時整段計入', () => {
    const r = computeActiveTime([ev('09:00'), ev('09:10', 'assistant'), ev('09:25')], opts);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ date: '2026-11-12', minutes: 25 });
    expect(r[0]!.firstTs).toBe(at('09:00'));
    expect(r[0]!.lastTs).toBe(at('09:25'));
  });

  it('剛好等於門檻仍計入；超過門檻只計寬限時間', () => {
    expect(computeActiveTime([ev('09:00'), ev('09:15')], opts)[0]!.minutes).toBe(15);
    expect(computeActiveTime([ev('09:00'), ev('09:16')], opts)[0]!.minutes).toBe(2);
    expect(computeActiveTime([ev('09:00'), ev('12:00'), ev('12:05')], opts)[0]!.minutes).toBe(7);
  });

  it('寬限值不超過實際間隔', () => {
    const r = computeActiveTime([ev('09:00'), ev('09:01')], { ...opts, idleThresholdMinutes: 0.5, idleGraceMinutes: 2 });
    expect(r[0]!.minutes).toBe(1);
  });

  it('工具執行期間（tool_use → tool_result）整段計入', () => {
    const r = computeActiveTime(
      [
        ev('09:00'),
        ev('09:01', 'tool_use', { toolUseId: 'b', toolName: 'Bash' }),
        ev('09:41', 'tool_result', { toolUseId: 'b' }),
        ev('10:30'), // 結果後 49 分鐘閒置 → 2 分鐘
      ],
      opts,
    );
    expect(r[0]!.minutes).toBe(1 + 40 + 2);
  });

  it('等待使用者回答的互動工具不套用例外', () => {
    const r = computeActiveTime(
      [
        ev('09:00', 'tool_use', { toolUseId: 'q', toolName: 'AskUserQuestion' }),
        ev('10:00', 'tool_result', { toolUseId: 'q' }),
      ],
      opts,
    );
    expect(r[0]!.minutes).toBe(2);
  });

  it('同一時間戳的多個事件與未排序輸入', () => {
    const r = computeActiveTime([ev('09:10'), ev('09:00'), ev('09:00', 'assistant')], opts);
    expect(r[0]!.minutes).toBe(10);
  });

  it('跨午夜的間隔按比例分到兩天（Asia/Taipei）', () => {
    const r = computeActiveTime([ev('23:50', 'user', {}, '2026-11-12'), ev('00:04', 'assistant', {}, '2026-11-13')], opts);
    expect(r.map((d) => [d.date, Math.round(d.minutes * 100) / 100])).toEqual([
      ['2026-11-12', 10],
      ['2026-11-13', 4],
    ]);
  });

  it('跨午夜的閒置間隔，寬限時間也依比例分配', () => {
    const r = computeActiveTime([ev('23:00', 'user', {}, '2026-11-12'), ev('01:00', 'user', {}, '2026-11-13')], opts);
    expect(r.map((d) => [d.date, d.minutes])).toEqual([
      ['2026-11-12', 1],
      ['2026-11-13', 1],
    ]);
  });

  it('依時區切分日期（UTC 16:00 前後屬於台北不同天）', () => {
    const r = computeActiveTime(
      [
        { ts: Date.parse('2026-11-12T15:55:00Z'), role: 'user' },
        { ts: Date.parse('2026-11-12T16:05:00Z'), role: 'assistant' },
      ],
      opts,
    );
    expect(r.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-13']);
  });

  it('多天後回到同一個對話，各天分開計算', () => {
    const r = computeActiveTime(
      [
        ...['09:00', '09:10', '09:20', '09:30'].map((h) => ev(h, 'user', {}, '2026-11-12')),
        ...['10:00', '10:10', '10:20'].map((h) => ev(h, 'user', {}, '2026-11-14')),
      ],
      opts,
    );
    // 中間 48.5 小時閒置只計 2 分鐘，依比例分配；11/13 沒有事件且不足 1 分鐘，不建立任務日
    const byDate = Object.fromEntries(r.map((d) => [d.date, d.minutes]));
    expect(Object.keys(byDate)).toEqual(['2026-11-12', '2026-11-14']);
    expect(byDate['2026-11-12']).toBeCloseTo(30 + (2 * 14.5) / 48.5, 6);
    expect(byDate['2026-11-14']).toBeCloseTo(20 + (2 * 10) / 48.5, 6);
    for (const d of r) expect(Number.isFinite(d.firstTs) && Number.isFinite(d.lastTs)).toBe(true);
  });

  it('工具執行跨越整天時，沒有事件的那天以分配區段為首末時間', () => {
    const r = computeActiveTime(
      [
        ev('23:00', 'tool_use', { toolUseId: 'b', toolName: 'Bash' }, '2026-11-12'),
        ev('01:00', 'tool_result', { toolUseId: 'b' }, '2026-11-14'),
      ],
      { ...opts, maxToolMinutes: 3000 },
    );
    expect(r.map((d) => [d.date, d.minutes])).toEqual([
      ['2026-11-12', 60],
      ['2026-11-13', 1440],
      ['2026-11-14', 60],
    ]);
    expect(r[1]!.firstTs).toBe(at('00:00', '2026-11-13'));
    expect(r[1]!.lastTs).toBe(at('00:00', '2026-11-14'));
  });

  it('沒有 tool_result 的工具不視為執行中', () => {
    const r = computeActiveTime(
      [
        ev('09:00', 'tool_use', { toolUseId: 'x', toolName: 'Bash' }),
        ev('09:05'), // 使用者中斷後發言
        ev('11:00'), // 閒置近 2 小時
      ],
      opts,
    );
    expect(r[0]!.minutes).toBe(5 + 2);
  });

  it('應用程式關閉後補寫的錯誤結果（interrupted）不視為執行中', () => {
    const r = computeActiveTime(
      [
        ev('18:00', 'tool_use', { toolUseId: 'x', toolName: 'Bash' }),
        ev('09:00', 'tool_result', { toolUseId: 'x', isError: true }, '2026-11-13'),
      ],
      opts,
    );
    expect(r.reduce((a, d) => a + d.minutes, 0)).toBeCloseTo(2, 6);
  });

  it('工具執行時間以 timeout 或 maxToolMinutes 為上限，超出部分依閒置規則', () => {
    const withTimeout = computeActiveTime(
      [
        ev('09:00', 'tool_use', { toolUseId: 'x', toolName: 'Bash', toolInput: { command: 'x', timeout: 600_000 } }),
        ev('10:00', 'tool_result', { toolUseId: 'x' }),
      ],
      opts,
    );
    expect(withTimeout[0]!.minutes).toBe(10 + 1 + 2); // timeout 10 分 + 1 分緩衝，剩 49 分閒置 → 2

    const noTimeout = computeActiveTime(
      [ev('09:00', 'tool_use', { toolUseId: 'a', toolName: 'Agent' }), ev('12:00', 'tool_result', { toolUseId: 'a' })],
      opts,
    );
    expect(noTimeout[0]!.minutes).toBe(120 + 2);

    const shortRest = computeActiveTime(
      [ev('09:00', 'tool_use', { toolUseId: 'a', toolName: 'Agent' }), ev('11:10', 'tool_result', { toolUseId: 'a' })],
      opts,
    );
    expect(shortRest[0]!.minutes).toBe(130); // 超出上限的 10 分鐘未達閒置門檻，照常計入
  });

  it('平行的工具呼叫時段合併計算', () => {
    const r = computeActiveTime(
      [
        ev('09:00', 'tool_use', { toolUseId: 'a', toolName: 'Bash' }),
        ev('09:00', 'tool_use', { toolUseId: 'b', toolName: 'Agent' }),
        ev('09:30', 'tool_result', { toolUseId: 'a' }),
        ev('10:00', 'tool_result', { toolUseId: 'b' }),
      ],
      opts,
    );
    expect(r[0]!.minutes).toBe(60);
  });

  it('空事件與單一事件', () => {
    expect(computeActiveTime([], opts)).toEqual([]);
    expect(computeActiveTime([ev('09:00')], opts)).toEqual([
      { date: '2026-11-12', minutes: 0, firstTs: at('09:00'), lastTs: at('09:00') },
    ]);
  });
});

describe('roundHours', () => {
  it('依 0.5 小時四捨五入', () => {
    expect(roundHours(362, 0.5)).toBe(6);
    expect(roundHours(375, 0.5)).toBe(6.5);
    expect(roundHours(14, 0.5)).toBe(0);
    expect(roundHours(15, 0.5)).toBe(0.5);
    expect(roundHours(100, 0.25)).toBe(1.75);
  });
});
