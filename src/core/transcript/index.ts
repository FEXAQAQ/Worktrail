/**
 * 規格 6.1：Claude Code 紀錄檔（JSONL）解析。
 *
 * 這是整個系統唯一處理原始紀錄格式的地方。原始格式沒有公開的穩定規格，
 * 因此這裡只挑必要欄位、對不認識的東西一律忽略，絕不丟出例外。
 */

export type EventRole = 'user' | 'assistant' | 'tool_use' | 'tool_result';

export interface TranscriptEvent {
  /** epoch 毫秒 */
  ts: number;
  role: EventRole;
  /** user / assistant 的文字；tool_result 的文字內容 */
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  /** tool_use 的 id，或 tool_result 對應的 tool_use id */
  toolUseId?: string;
  /** 子代理（sidechain）中的事件 */
  sidechain?: boolean;
  /** tool_result 是否為錯誤（包含因對話結束而中斷的呼叫） */
  isError?: boolean;
  /**
   * 分叉（fork）對話從原對話複製過來的歷史訊息。Claude Desktop 分叉時會把原對話的
   * 訊息整份複製到新檔案並改寫 sessionId，但保留原本的時間戳；這些訊息的時間
   * 早於新檔案的建立時間。不計入活躍時間，但仍可作為單號與標題的線索。
   */
  copied?: boolean;
}

/** 紀錄檔中與事件無關、但擷取需要的中繼資料 */
export interface TranscriptMeta {
  sessionId?: string;
  cwd?: string;
  /** 依出現順序、不重複的 git 分支 */
  branches: string[];
  /** Claude Desktop 自動產生或使用者改過的對話標題 */
  customTitle?: string;
  version?: string;
  /** 檔案中第一個帶時間戳的行（依檔案順序），視為 session 建立時間（epoch 毫秒） */
  createdTs?: number;
}

/** 早於建立時間超過此值的訊息視為從原對話複製而來 */
const COPIED_TOLERANCE_MS = 1000;

export interface ParsedTranscript {
  events: TranscriptEvent[];
  meta: TranscriptMeta;
  /** 無法解析為 JSON 的行數（格式變動的訊號） */
  badLines: number;
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** 系統注入到使用者訊息中的區塊，不屬於使用者實際輸入 */
const INJECTED_BLOCK = /<(system-reminder|local-command-stdout|local-command-stderr)>[\s\S]*?<\/\1>/g;

function cleanUserText(text: string): string {
  return text.replace(INJECTED_BLOCK, '').trim();
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (isObj(b) && b.type === 'text' ? (str(b.text) ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function createMeta(): TranscriptMeta {
  return { branches: [] };
}

/**
 * 解析單一行，將事件推入 `out`、更新 `meta`。
 * 回傳 false 代表該行不是合法 JSON。供增量讀取（byte offset）使用。
 */
export function parseLine(line: string, meta: TranscriptMeta, out: TranscriptEvent[]): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  let o: unknown;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!isObj(o)) return true;

  if (meta.createdTs === undefined) {
    const t = Date.parse(str(o.timestamp) ?? '');
    if (!Number.isNaN(t)) meta.createdTs = t;
  }

  const type = str(o.type);

  if (type === 'custom-title' || type === 'summary') {
    const t = str(o.customTitle) ?? (type === 'summary' ? str(o.summary) : undefined);
    if (t && type === 'custom-title') meta.customTitle = t;
    return true;
  }
  if (type !== 'user' && type !== 'assistant') return true;

  // 共用中繼資料
  meta.sessionId ??= str(o.sessionId);
  const cwd = str(o.cwd);
  if (cwd) meta.cwd = cwd;
  const branch = str(o.gitBranch);
  if (branch && branch !== 'HEAD' && !meta.branches.includes(branch)) meta.branches.push(branch);
  meta.version = str(o.version) ?? meta.version;

  const ts = Date.parse(str(o.timestamp) ?? '');
  if (Number.isNaN(ts)) return true;
  const sidechain = o.isSidechain === true ? true : undefined;

  const msg = o.message;
  if (!isObj(msg)) return true;
  const content = msg.content;

  const copied = meta.createdTs !== undefined && ts < meta.createdTs - COPIED_TOLERANCE_MS ? true : undefined;
  const start = out.length;
  parseMessage(type, o, ts, sidechain, content, out);
  if (copied) for (let i = start; i < out.length; i++) out[i]!.copied = true;
  return true;
}

function parseMessage(
  type: 'user' | 'assistant',
  o: Json,
  ts: number,
  sidechain: true | undefined,
  content: unknown,
  out: TranscriptEvent[],
): void {
  if (type === 'user') {
    // 系統產生的中繼訊息（例如 slash command 展開的說明、壓縮摘要）不算使用者輸入
    if (o.isMeta === true || o.isCompactSummary === true) return;
    if (typeof content === 'string') {
      const text = cleanUserText(content);
      if (text) out.push({ ts, role: 'user', text, sidechain });
      return;
    }
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const b of content) {
        if (!isObj(b)) continue;
        if (b.type === 'tool_result') {
          out.push({
            ts,
            role: 'tool_result',
            toolUseId: str(b.tool_use_id),
            text: blockText(b.content),
            isError: b.is_error === true ? true : undefined,
            sidechain,
          });
        } else if (b.type === 'text') {
          const t = cleanUserText(str(b.text) ?? '');
          if (t) texts.push(t);
        }
      }
      if (texts.length) out.push({ ts, role: 'user', text: texts.join('\n'), sidechain });
    }
    return;
  }

  // assistant
  if (typeof content === 'string') {
    if (content.trim()) out.push({ ts, role: 'assistant', text: content, sidechain });
    return;
  }
  if (!Array.isArray(content)) return;
  let sawThinking = false;
  for (const b of content) {
    if (!isObj(b)) continue;
    if (b.type === 'text') {
      const t = str(b.text);
      if (t && t.trim()) out.push({ ts, role: 'assistant', text: t, sidechain });
    } else if (b.type === 'tool_use') {
      out.push({
        ts,
        role: 'tool_use',
        toolName: str(b.name),
        toolInput: b.input,
        toolUseId: str(b.id),
        sidechain,
      });
    } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
      sawThinking = true;
    }
  }
  // 只有思考內容的回應仍代表 Claude 在工作，保留時間戳
  if (sawThinking && !content.some((b) => isObj(b) && (b.type === 'text' || b.type === 'tool_use'))) {
    out.push({ ts, role: 'assistant', sidechain });
  }
  return;
}

/** 解析整份紀錄檔內容。事件依時間排序（穩定排序，同時間保留原順序）。 */
export function parseTranscript(content: string): ParsedTranscript {
  const meta = createMeta();
  const events: TranscriptEvent[] = [];
  let badLines = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!parseLine(line, meta, events)) badLines++;
  }
  events.sort((a, b) => a.ts - b.ts);
  return { events, meta, badLines };
}

/** 非子代理的使用者訊息（使用者實際輸入的內容） */
export function userMessages(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  return events.filter((e) => e.role === 'user' && !e.sidechain && e.text);
}

/**
 * 紀錄檔片段（通常是檔尾）中，還沒有對應 tool_result 的 tool_use。
 * Claude Code 在執行工具前就會把 tool_use 寫入紀錄檔，因此 MCP 工具執行中時，
 * 呼叫它的那個對話的紀錄檔裡會有一筆尚未回覆的呼叫。片段開頭被截斷的行會被忽略。
 */
export function pendingToolUses(content: string): { name: string; ts: number }[] {
  const meta = createMeta();
  const events: TranscriptEvent[] = [];
  for (const line of content.split(/\r?\n/)) parseLine(line, meta, events);
  const answered = new Set(events.filter((e) => e.role === 'tool_result' && e.toolUseId).map((e) => e.toolUseId));
  return events
    .filter((e) => e.role === 'tool_use' && e.toolName && !e.sidechain && !e.copied && !(e.toolUseId && answered.has(e.toolUseId)))
    .map((e) => ({ name: e.toolName!, ts: e.ts }));
}
