/**
 * 規格 6.3：單號辨識（分數制，純函式）。
 */
import type { TranscriptEvent } from '../transcript/index.js';

/**
 * 規格寫的是 `\b([A-Z][A-Z0-9]+)-(\d+)\b`。這裡改用前後瞻斷言：
 * `\b` 會把 `feature/TDDA-1869_fix` 這種底線接續的分支名漏掉（底線屬於 word 字元）。
 */
const TICKET_RE = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]+)-(\d+)(?![0-9])/g;

/** 預設：工具名稱含 jira 或 atlassian 即視為 Jira 工具（規格 17 待決事項的預設假設） */
export function isJiraTool(name: string | undefined): boolean {
  return !!name && /jira|atlassian/i.test(name);
}

export function extractTickets(text: string, keys: readonly string[]): string[] {
  const allow = new Set(keys);
  const found: string[] = [];
  for (const m of text.matchAll(TICKET_RE)) {
    if (allow.has(m[1]!)) found.push(`${m[1]}-${m[2]}`);
  }
  return found;
}

export interface TicketScore {
  ticket: string;
  score: number;
  /** 首次出現的排序鍵（越小越早） */
  firstSeen: number;
  sources: Record<string, number>;
}

export interface TicketResult {
  ticket: string | null;
  related: string[];
  scores: TicketScore[];
}

export const TICKET_WEIGHTS = {
  jira_tool: 5,
  first_user_message: 5,
  branch: 4,
  commit: 3,
  user_message: 1,
  assistant: 0.5,
  assistant_cap: 3,
  related_min: 3,
} as const;

export interface TicketInput {
  events: readonly TranscriptEvent[];
  branches: readonly string[];
  commitMessages: readonly string[];
  keys: readonly string[];
}

export function scoreTickets(input: TicketInput): TicketResult {
  const { keys } = input;
  const W = TICKET_WEIGHTS;
  const table = new Map<string, TicketScore>();
  let order = 0;

  const add = (tickets: Iterable<string>, source: string, pts: number, seen: number) => {
    for (const t of new Set(tickets)) {
      let s = table.get(t);
      if (!s) {
        s = { ticket: t, score: 0, firstSeen: seen, sources: {} };
        table.set(t, s);
      }
      s.firstSeen = Math.min(s.firstSeen, seen);
      s.score += pts;
      s.sources[source] = (s.sources[source] ?? 0) + pts;
    }
  };

  const assistantPts = new Map<string, number>();
  let firstUserDone = false;

  for (const e of input.events) {
    order++;
    if (e.role === 'user' && !e.sidechain && e.text) {
      const ts = extractTickets(e.text, keys);
      if (!firstUserDone) {
        firstUserDone = true;
        add(ts, 'first_user_message', W.first_user_message, order);
      } else {
        add(ts, 'user_message', W.user_message, order);
      }
    } else if (e.role === 'assistant' && e.text) {
      for (const t of new Set(extractTickets(e.text, keys))) {
        const used = assistantPts.get(t) ?? 0;
        const pts = Math.min(W.assistant, W.assistant_cap - used);
        if (pts <= 0) continue;
        assistantPts.set(t, used + pts);
        add([t], 'assistant', pts, order);
      }
    } else if (e.role === 'tool_use' && isJiraTool(e.toolName)) {
      add(extractTickets(JSON.stringify(e.toolInput ?? ''), keys), 'jira_tool', W.jira_tool, order);
    }
  }

  // 分支與 commit 不在時間軸上，排在所有對話事件之後
  for (const b of input.branches) add(extractTickets(b, keys), 'branch', W.branch, ++order);
  for (const c of input.commitMessages) add(extractTickets(c, keys), 'commit', W.commit, ++order);

  const scores = [...table.values()].sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen);
  // 只出現在 Claude 回應中的單號（例如 Claude 舉例或引用）不代表正在處理，不列為主單號或相關單號
  const eligible = scores.filter((s) => Object.keys(s.sources).some((k) => k !== 'assistant'));
  const top = eligible[0];
  return {
    ticket: top ? top.ticket : null,
    related: eligible.slice(1).filter((s) => s.score >= W.related_min).map((s) => s.ticket),
    scores,
  };
}

/** 看起來像單號、但通常不是的代碼（編碼、雜湊、標準文件、漏洞編號等） */
const NOT_TICKET_KEYS = new Set(['UTF', 'SHA', 'MD', 'ISO', 'RFC', 'CVE', 'CWE', 'GHSA', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'AES', 'RSA', 'UTC', 'GMT', 'ES', 'IE', 'GPT', 'WIN', 'X86', 'X64', 'ARM', 'IPV', 'PEP', 'JSR', 'ECMA', 'IEEE', 'KB']);

export interface TicketKeySuggestion {
  key: string;
  /** 在分支名稱中出現的任務數 */
  branch_tasks: number;
  /** 出現在分支、commit 或標題中的任務數 */
  tasks: number;
  /** 例子：第一個出現的單號與來源 */
  example: { ticket: string; source: 'branch' | 'commit' | 'title'; text: string };
}

/**
 * 找出還沒加入 Jira 專案代碼、但在任務的分支、commit 訊息或標題中出現的代碼，讓使用者一鍵加入。
 * 分支名稱出現一次就建議（分支幾乎都以單號命名）；只在 commit 或標題出現的，要有 2 個以上任務才建議。
 */
export function suggestTicketKeys(
  tasks: readonly { branch?: string; title?: string; commits?: readonly { message: string }[] }[],
  keys: readonly string[],
  ignored: readonly string[] = [],
): TicketKeySuggestion[] {
  const skip = new Set([...keys, ...ignored].map((k) => k.toUpperCase()));
  const found = new Map<string, TicketKeySuggestion>();
  for (const t of tasks) {
    const seen = new Set<string>();
    const sources: [TicketKeySuggestion['example']['source'], string][] = [
      ['branch', t.branch ?? ''],
      ...(t.commits ?? []).map((c) => ['commit', c.message] as [TicketKeySuggestion['example']['source'], string]),
      ['title', t.title ?? ''],
    ];
    for (const [source, text] of sources) {
      for (const m of text.matchAll(TICKET_RE)) {
        const key = m[1]!;
        if (skip.has(key) || NOT_TICKET_KEYS.has(key) || key.length > 10) continue;
        let s = found.get(key);
        if (!s) found.set(key, (s = { key, branch_tasks: 0, tasks: 0, example: { ticket: m[0], source, text } }));
        if (!seen.has(key)) {
          seen.add(key);
          s.tasks++;
        }
        if (source === 'branch' && !seen.has(`branch:${key}`)) {
          seen.add(`branch:${key}`);
          s.branch_tasks++;
        }
      }
    }
  }
  return [...found.values()].filter((s) => s.branch_tasks >= 1 || s.tasks >= 2)
    // 分支名稱的證據最強，排在前面
    .sort((a, b) => b.branch_tasks - a.branch_tasks || b.tasks - a.tasks || a.key.localeCompare(b.key));
}

type TicketKeySettings = { keys: string[]; ignored_keys: string[] };

/** 使用者對建議的代碼按「加入」或「不是單號」後的設定 */
export function applyTicketKeyAction<T extends TicketKeySettings>(ticket: T, key: string, action: 'add' | 'ignore'): T {
  return action === 'add'
    ? { ...ticket, keys: [...new Set([...ticket.keys, key])], ignored_keys: ticket.ignored_keys.filter((k) => k !== key) }
    : { ...ticket, ignored_keys: [...new Set([...ticket.ignored_keys, key])] };
}

/** 分支、標題或 commit 訊息中提到這個代碼單號（例如 ABC-123）的任務 */
export function tasksMentioningKey<T extends { branch: string; title: string; commits: readonly { message: string }[] }>(
  tasks: readonly T[],
  key: string,
): T[] {
  const re = new RegExp(`(?<![A-Za-z0-9])${key}-\\d+`);
  return tasks.filter((t) => re.test(t.branch) || re.test(t.title) || t.commits.some((c) => re.test(c.message)));
}
