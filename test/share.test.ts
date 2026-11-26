import { describe, expect, it } from 'vitest';
import { formatStamp, isTooLongForTelegram, SHARE_LONG_LIMIT, shareFileName, splitLeadingHeading } from '../ui/src/lib/share.js';

describe('一鍵快照：純函式', () => {
  const d = new Date(2026, 10, 18, 9, 5);

  it('時間戳與檔名', () => {
    expect(formatStamp(d)).toBe('2026-11-18 09:05');
    expect(shareFileName('週報 2026-W46', d)).toBe('週報 2026-W46-20261118-0905.png');
    expect(shareFileName('a/b:c*?"<>|d', d)).toBe('a b c d-20261118-0905.png');
    expect(shareFileName('  ', d)).toBe('worktrail-20261118-0905.png');
  });

  it('長圖判斷', () => {
    expect(isTooLongForTelegram(SHARE_LONG_LIMIT)).toBe(false);
    expect(isTooLongForTelegram(SHARE_LONG_LIMIT + 1)).toBe(true);
  });

  it('拆出開頭的一級標題', () => {
    expect(splitLeadingHeading('# 週報 2026-W46\n\n## 本週重點\n- a')).toEqual({ heading: '週報 2026-W46', body: '## 本週重點\n- a' });
    expect(splitLeadingHeading('\n#  標題 ##\r\n內文')).toEqual({ heading: '標題', body: '內文' });
    expect(splitLeadingHeading('## 二級標題\n內文')).toEqual({ heading: null, body: '## 二級標題\n內文' });
    expect(splitLeadingHeading('前言\n# 標題')).toEqual({ heading: null, body: '前言\n# 標題' });
    expect(splitLeadingHeading('# 只有標題')).toEqual({ heading: '只有標題', body: '' });
  });
});
