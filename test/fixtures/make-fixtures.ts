/**
 * 產生合成紀錄檔 fixture（結構與 Claude Code 2.1.x 相同，內容為虛構）。
 * 執行：npx tsx test/fixtures/make-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { assistantText, noise, thinking, toolResult, toolUse, tw, user } from '../helpers.js';

const lines = [
  noise.customTitle('發送演練 API 規劃'),
  user(tw('09:40'), '請讀取 TDDA-1869 並開始開發'),
  noise.attachment(tw('09:40')),
  noise.apiRequest(tw('09:40')),
  thinking(tw('09:41')),
  toolUse(tw('09:41'), 'j1', 'mcp__atlassian-rovo-mcp__getJiraIssue', { cloudId: 'x', issueIdOrKey: 'TDDA-1869' }),
  toolResult(tw('09:41'), 'j1', [{ type: 'text', text: JSON.stringify({ key: 'TDDA-1869', fields: { summary: '[BE] 發送演練 API + DB規劃' } }) }]),
  assistantText(tw('09:43'), '已讀取 TDDA-1869，開始規劃 API。UTF-8 編碼沿用。'),
  toolUse(tw('09:44'), 'b1', 'Bash', { command: 'dotnet test' }),
  // 測試跑了 25 分鐘
  toolResult(tw('10:09'), 'b1', 'Passed!'),
  assistantText(tw('10:10'), '測試通過。'),
  // 午休 80 分鐘
  user(tw('11:30'), '再加上 DKIM 設定，參考 TDDA-1700'),
  toolUse(tw('11:31'), 'e1', 'Edit', { file_path: 'Mail/Dkim.cs' }),
  toolResult(tw('11:31'), 'e1', 'ok'),
  assistantText(tw('11:40'), '完成 DKIM 設定。'),
  // 隔天凌晨跨日
  user(tw('23:55'), '最後確認'),
  assistantText(new Date('2026-11-13T00:05:00+08:00').toISOString(), '確認完成。'),
  noise.costState(),
];
writeFileSync(new URL('./transcripts/synthetic-tdda-1869.jsonl', import.meta.url), lines.join('\n') + '\n');
console.log('ok');
