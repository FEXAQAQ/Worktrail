import { existsSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listPrompts, loadPrompt, validatePrompt } from '../src/core/prompt/index.js';
import { prepareReport } from '../src/core/report/prepare.js';
import { Config } from '../src/core/schema/config.js';
import { makeEnv, type TestEnv } from './env.js';

describe('年度考核表範本（performance/appraisal）', () => {
  let env: TestEnv;
  beforeAll(() => {
    env = makeEnv();
  });
  afterAll(() => env.cleanup());

  it('內建範本可載入、通過驗證，安裝時複製一份', () => {
    const p = loadPrompt(env.paths, 'performance/appraisal');
    expect(p.type).toBe('performance');
    expect(p.title).toBe('年度考核表（STAR）');
    expect(validatePrompt('performance/x', p.text)).toEqual({ errors: [], warnings: [] });
    expect(existsSync(env.paths.promptFile('performance', 'appraisal'))).toBe(true);
  });

  it('依考核表三欄與 STAR 四段輸出', () => {
    const body = loadPrompt(env.paths, 'performance/appraisal').body;
    for (const s of ['### 專案/日常任務', '### 執行內容/要項', '### 請描述達成狀況', '情境 (Situation)', '任務 (Task)', '執行內容 (Action)', '量化成果 (Result)']) {
      expect(body).toContain(s);
    }
  });

  it('舊安裝沒有檔案：退回內建內容並列在清單中', () => {
    rmSync(env.paths.promptFile('performance', 'appraisal'));
    expect(loadPrompt(env.paths, 'performance/appraisal').body).toContain('STAR');
    expect(listPrompts(env.paths).filter((x) => x.ref === 'performance/appraisal')).toHaveLength(1);
  });

  it('產生績效時可選用，填入期間與週報', () => {
    const p = prepareReport({
      paths: env.paths,
      config: Config.parse({}),
      type: 'performance',
      period: { start: '2026-01-01', end: '2026-12-31' },
      prompt: 'performance/appraisal',
      today: '2026-11-19',
    });
    expect(p.prompt_name).toBe('performance/appraisal');
    expect(p.rendered_prompt).toContain('（本期間沒有週報）');
    expect(p.rendered_prompt).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });
});
