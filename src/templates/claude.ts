/** 規格 8：slash commands 與 CLAUDE.md 規則區塊。 */

export const CLAUDE_MD_START = '<!-- worktrail:start -->';
export const CLAUDE_MD_END = '<!-- worktrail:end -->';

export const CLAUDE_MD_BLOCK = `${CLAUDE_MD_START}
## 工作日誌（Worktrail）
- 完成使用者交代的開發任務，或任務告一段落（例如 commit 之後）時，呼叫 worklog_save_summary 更新本對話的工作日誌（撰寫規則在工具說明中）。
- 收到 [Worktrail] 要求更新日誌的提示時，先更新日誌再繼續。
${CLAUDE_MD_END}`;

/** 指令檔都帶這個標記，移除時只刪除 Worktrail 自己的檔案 */
export const COMMAND_MARKER = '<!-- worktrail:command -->';

export const SLASH_COMMANDS: Record<string, string> = {
  'worklog.md': `---
description: 整理本對話的進度並寫入 Worktrail 工作日誌
---
${COMMAND_MARKER}
1. 依 worklog_save_summary 工具說明中的撰寫規則，整理本對話到目前為止的工作。
2. 呼叫 worklog_save_summary 寫入；回應中若有 next_step，照著補完。
3. 簡短回覆已記錄的子項數與 UI 網址。
`,
  'worklog-weekly.md': `---
description: 產生 Worktrail 週報
argument-hint: [current|previous|起~迄] [prompt 名稱]
---
${COMMAND_MARKER}
1. 呼叫 worklog_report_prepare，type=weekly，period 與 prompt 取自參數：$ARGUMENTS
   （period 可為 current、previous，或 YYYY-MM-DD~YYYY-MM-DD；未提供時用 current）
2. 若 warnings 不為空，先列出並詢問使用者是否繼續。
3. 依 rendered_prompt 撰寫週報。統計數字只能引用 stats，不可自行計算。
4. 呼叫 worklog_report_save 儲存（只需 type、prepare 回傳的 period_id 與內容），並回覆 UI 預覽網址。
`,
  'worklog-perf.md': `---
description: 產生 Worktrail 績效總結
argument-hint: [current|previous|起~迄] [prompt 名稱]
---
${COMMAND_MARKER}
1. 呼叫 worklog_report_prepare，type=performance，period 與 prompt 取自參數：$ARGUMENTS
   （period 可為 current、previous，或 YYYY-MM-DD~YYYY-MM-DD；未提供時用 current）
2. 若 warnings 不為空（例如缺少週報），先列出並詢問使用者是否繼續。
3. 依 rendered_prompt 撰寫績效總結。統計數字只能引用 stats，不可自行計算。
4. 呼叫 worklog_report_save 儲存（只需 type、prepare 回傳的 period_id 與內容），並回覆 UI 預覽網址。
`,
  'worklog-ui.md': `---
description: 開啟 Worktrail 工作日誌 UI
---
${COMMAND_MARKER}
呼叫 worklog_open_ui 開啟 Worktrail 視窗，並回覆 UI 網址。
`,
};

export const MCP_INSTRUCTIONS = `Worktrail 是使用者的工作日誌系統。每個 Claude Code 對話是一個任務。
- 任務完成或告一段落時，直接呼叫 worklog_save_summary：撰寫規則在它的工具說明中，不需要帶 session_id，也不需要先呼叫其他工具。
- 回應中若有 next_step，照著補完。
- 只有在工具回報無法判斷是哪個對話時，才帶上對話開頭 [Worktrail] 訊息中的 session_id 重試。`;
