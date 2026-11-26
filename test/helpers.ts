/** 產生與 Claude Code 2.1.x 紀錄檔相同結構的 JSONL 行（合成資料，不含真實內容）。 */

export const SID = 'a1b2c3d4-0000-4000-8000-000000000001';
const base = {
  sessionId: SID,
  cwd: 'D:\\repos\\se-platform',
  gitBranch: 'feature/TDDA-1869',
  version: '2.1.321',
  isSidechain: false,
  userType: 'external',
  entrypoint: 'claude-desktop',
};

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export function user(ts: string, content: string | unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ ...base, type: 'user', uuid: uuid(), timestamp: ts, message: { role: 'user', content }, ...extra });
}

export function assistantText(ts: string, text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    ...base,
    type: 'assistant',
    uuid: uuid(),
    timestamp: ts,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  });
}

export function toolUse(ts: string, id: string, name: string, input: unknown) {
  return JSON.stringify({
    ...base,
    type: 'assistant',
    uuid: uuid(),
    timestamp: ts,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
}

export function toolResult(ts: string, id: string, content: unknown) {
  return user(ts, [{ type: 'tool_result', tool_use_id: id, content }]);
}

export function thinking(ts: string) {
  return JSON.stringify({
    ...base,
    type: 'assistant',
    uuid: uuid(),
    timestamp: ts,
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] },
  });
}

export const noise = {
  customTitle: (t: string) => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: SID }),
  apiRequest: (ts: string) => JSON.stringify({ type: 'api-request', sessionId: SID, timestamp: ts, id: 'x' }),
  attachment: (ts: string) =>
    JSON.stringify({ ...base, type: 'attachment', timestamp: ts, attachment: { type: 'environment' } }),
  costState: () => JSON.stringify({ type: 'cost-state', sessionId: SID, totalCostUSD: 1 }),
};

/** 把 fixture 行的 cwd、sessionId、gitBranch 換成整合測試用的值 */
export function retarget(lines: string[], cwd: string, sessionId: string, gitBranch = 'feature/TDDA-1869'): string[] {
  return lines.map((l) => {
    const o = JSON.parse(l) as Record<string, unknown>;
    if ('sessionId' in o) o.sessionId = sessionId;
    if ('cwd' in o) o.cwd = cwd;
    if ('gitBranch' in o) o.gitBranch = gitBranch;
    return JSON.stringify(o);
  });
}

/** 以 +08:00 表示的時間轉成 UTC ISO 字串 */
export const tw = (hhmm: string, date = '2026-11-12') => new Date(`${date}T${hhmm}:00+08:00`).toISOString();
