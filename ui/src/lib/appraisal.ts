/**
 * 年度考核表範本（performance/appraisal）的輸出 → 考核表的列。
 * 結構：`## 專案名稱` 底下有 `### 專案/日常任務`、`### 執行內容/要項`、`### 請描述達成狀況` 三欄。
 * 依內容判斷而不是範本名稱，使用者另存或修改過的範本也適用。
 * 純函式、不引入其他模組，讓後端的 vitest 能直接載入。
 */

export interface AppraisalRow {
  project: string;
  items: string;
  result: string;
}

export const APPRAISAL_COLUMNS = ['專案/日常任務', '執行內容/要項', '請描述達成狀況'] as const;

const COLUMN_KEY: Record<string, keyof AppraisalRow> = {
  '專案/日常任務': 'project',
  '執行內容/要項': 'items',
  '請描述達成狀況': 'result',
};

/** 儲存格是純文字：去掉粗體、行內程式碼標記與前後空行 */
function cellText(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 解析考核表內容；沒有任何一列符合結構時回傳 null（改用一般 Markdown 顯示） */
export function parseAppraisal(markdown: string): AppraisalRow[] | null {
  const rows: AppraisalRow[] = [];
  let heading: string | null = null;
  let cols: Partial<Record<keyof AppraisalRow, string[]>> = {};
  let current: string[] | null = null;

  const flush = () => {
    if (heading !== null && (cols.items || cols.result)) {
      rows.push({
        project: cellText(cols.project ?? []) || heading,
        items: cellText(cols.items ?? []),
        result: cellText(cols.result ?? []),
      });
    }
    cols = {};
    current = null;
  };

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2 && !line.startsWith('###')) {
      flush();
      heading = h2[1]!;
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      const key = COLUMN_KEY[h3[1]!.replace(/\s+/g, '')];
      if (key && heading !== null) {
        current = cols[key] = [];
        continue;
      }
      current = null;
      continue;
    }
    if (/^#\s/.test(line)) {
      flush();
      heading = null;
      continue;
    }
    current?.push(line);
  }
  flush();
  return rows.length ? rows : null;
}

/** 報告的標題（第一個 `# `），表格上方顯示用 */
export function appraisalTitle(markdown: string): string | null {
  return /^#\s+(.+?)\s*$/m.exec(markdown)?.[1] ?? null;
}
