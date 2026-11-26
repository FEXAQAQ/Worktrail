# Worktrail 開發說明

- 實作前先讀 `docs/架構與運作原理.md` 與 `docs/DECISIONS.md` 的相關段落。`docs/SPEC.md` 是開發初期的原始規格，只留在本機、不進版控，可能不存在，也可能已過時。
- 新的設計決定、與既有行為不同的改動、紀錄檔格式觀察，記在 `docs/DECISIONS.md`；改到流程或元件分工時，同步更新 `docs/架構與運作原理.md`；改到使用者操作時，同步更新 `docs/使用說明.md` 或 `docs/安裝與解除說明.md`。
- `README.md` 是產品介紹頁，只放賣點、運作概念、開始使用與文件索引，操作細節放在 `docs/`。
- `src/core/` 不依賴 MCP、HTTP 或 UI；所有業務邏輯放在這裡並附單元測試（vitest）。
- Claude Code 紀錄檔（JSONL）的原始格式只能在 `src/core/transcript/` 處理，其他模組只用標準化事件。
- 寫檔一律原子寫入（`writeFileAtomic`）並取得檔案鎖（`withLock`）。
- 時間以 ISO 8601 含時區儲存，計算依 `time.timezone`。
- hook 相關程式任何錯誤都要 exit 0（把關的 exit 2 除外），執行時間上限 2 秒。
- 測試以 `WORKTRAIL_HOME`、`CLAUDE_CONFIG_DIR` 指向暫存資料夾（見 `test/env.ts`），絕不碰使用者真實的 `~/.claude`。

## 結構

- `src/core/`：schema、transcript、capture（時間／單號／標題／專案／git）、storage、sync（擷取流程、把關、補漏、編輯）、period、stats、prompt、report、summary、claude-cli
- `src/hook/`、`src/mcp/`、`src/daemon/`（HTTP API、SSE、排程）、`src/installer/`、`src/launcher/`、`src/templates/`
- `ui/`：React 19 + Vite + Tailwind 4，建置輸出到 `dist/ui`

## 指令

- `npm test`（會先建置後端）、`npm run typecheck`、`npm run build`、`npm run build:launcher`
- `npm run dev -- analyze <紀錄檔或資料夾> --table`
- `npm run demo:gif`：UI 外觀有明顯改變時，以虛構資料重錄 README 的 `docs/images/demo.gif`（說明見 `docs/架構與運作原理.md` 第 8 節）
