import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../src/core/capture/analyze.js';
import { Config } from '../src/core/schema/config.js';
import { parseTranscript } from '../src/core/transcript/index.js';

const fixture = readFileSync(new URL('./fixtures/transcripts/synthetic-tdda-1869.jsonl', import.meta.url), 'utf8');

describe('analyzeSession（合成 fixture）', () => {
  const config = Config.parse({ projects: [{ name: '社交工程', match: { paths: ['D:/repos/se-*'] } }] });

  it('產生每日草稿：時間、單號、標題、專案', () => {
    const r = analyzeSession({
      parsed: parseTranscript(fixture),
      config,
      commits: [
        { sha: '3f9a1c2', message: 'feat: TDDA-1869 發送演練 API 規劃', ts: Date.parse('2026-11-12T11:35:00+08:00') },
      ],
    });
    expect(r.warnings).toEqual([]);
    expect(r).toMatchObject({
      session_id: 'a1b2c3d4-0000-4000-8000-000000000001',
      repo: 'D:\\repos\\se-platform',
      branch: 'feature/TDDA-1869',
      ticket: 'TDDA-1869',
      project: '社交工程',
      project_unmapped: false,
      title: { title: '[BE] 發送演練 API + DB規劃', source: 'jira' },
    });
    // 09:40–10:10 = 30（含 25 分鐘測試）、午休 +2、11:30–11:40 = 10、晚間閒置 +2、跨午夜 10 分鐘各半
    expect(r.days).toEqual([
      {
        date: '2026-11-12',
        active_minutes: 49,
        hours: 1,
        first_activity: '2026-11-12T09:40:00+08:00',
        last_activity: '2026-11-12T23:55:00+08:00',
        commits: [{ sha: '3f9a1c2', message: 'feat: TDDA-1869 發送演練 API 規劃' }],
      },
      {
        date: '2026-11-13',
        active_minutes: 5,
        hours: 0,
        first_activity: '2026-11-13T00:05:00+08:00',
        last_activity: '2026-11-13T00:05:00+08:00',
        commits: [],
      },
    ]);
    // TDDA-1700 只出現在一般使用者訊息（1 分），不列入 related
    expect(r.related_tickets).toEqual([]);
  });

  it('格式完全不認得時降級並提出警告', () => {
    const r = analyzeSession({ parsed: parseTranscript('{"type":"x"}\nnot-json'), config, sessionIdFallback: 'abc' });
    expect(r.session_id).toBe('abc');
    expect(r.days).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
});
