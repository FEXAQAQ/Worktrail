import { describe, expect, it } from 'vitest';
import { sectionsForDate } from '../src/core/summary/jira.js';
import { type CopyTask as T, jiraProgressText, plain, progressHeading, tasksForTicket } from '../ui/src/lib/jira-copy.js';
const task = (p: Partial<T> & { id: string }): T => ({ date: '2026-11-18', ticket: 'TDDA-1869', title: '', items: [], first_activity: undefined, ...p });

describe('複製 Jira 進度：純函式', () => {
  const a = task({
    id: 'a',
    first_activity: '2026-11-18T09:00:00+08:00',
    title: '[TDDA-1869] 發送演練 API',
    items: [
      { text: '整理 **Postfix＋DKIM** 步驟', status: 'done' },
      { text: '發送演練 API 規劃', status: 'pending', note: '未 commit' },
    ],
  });
  const b = task({
    id: 'b',
    ticket: 'tdda-1869',
    first_activity: '2026-11-18T14:00:00+08:00',
    items: [
      { text: '取得 DKIM 私鑰', status: 'blocked', note: '等 SE\n提供' },
      { text: '整理 **Postfix＋DKIM** 步驟', status: 'done' },
    ],
  });
  const other = task({ id: 'c', ticket: 'TDDA-1', items: [{ text: '別張單', status: 'done' }] });
  const yesterday = task({ id: 'd', date: '2026-11-17', items: [{ text: '昨天', status: 'done' }] });

  it('同一天同單號（不分大小寫）的任務合在一起，依開始時間排序', () => {
    expect(tasksForTicket([b, other, yesterday, a], b).map((t) => t.id)).toEqual(['a', 'b']);
    const none = task({ id: 'n', ticket: null });
    expect(tasksForTicket([a, none], none)).toEqual([none]);
  });

  it('輸出乾淨純文字：日期行、狀態標籤、備註，重複子項只列一次', () => {
    const r = jiraProgressText(tasksForTicket([a, b], a));
    expect(r.text).toBe(
      ['2026/11/18','- [完成] 整理 Postfix＋DKIM 步驟', '- [待進行] 發送演練 API 規劃（未 commit）', '- [卡住] 取得 DKIM 私鑰（等 SE 提供）'].join('\n'),
    );
    expect(r.items).toBe(3);
    expect(r.titleOnly).toBe(false);
  });

  it('沒有子項時改列標題（去掉重複的單號）', () => {
    const r = jiraProgressText([task({ id: 'x', title: 'TDDA-1869：發送演練 API' })]);
    expect(r).toEqual({ text: '2026/11/18\n- 發送演練 API', items: 0, titleOnly: true });
  });

  it('日期行與 plain', () => {
    expect(progressHeading('2026-01-05')).toBe('2026/01/05');
    expect(plain('  `a`  \n b ')).toBe('a b');
  });

  it('貼到 Jira 後，「從 Jira 整理」能依日期讀回', () => {
    const today = jiraProgressText([a]).text;
    const prev = jiraProgressText([yesterday]).text;
    const comment = `${prev}\n\n${today}`;
    expect(sectionsForDate(comment, '2026-11-18')).toEqual([today.split('\n').slice(1).join('\n')]);
    expect(sectionsForDate(comment, '2026-11-17')).toEqual(['- [完成] 昨天']);
  });
});
