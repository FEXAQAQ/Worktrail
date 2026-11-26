/**
 * 規格 6.2：活躍時間演算法（純函式）。
 */
import type { TranscriptEvent } from '../transcript/index.js';
import { localDate, nextLocalMidnight } from './tz.js';

export interface ActiveTimeOptions {
  timezone: string;
  idleThresholdMinutes: number;
  idleGraceMinutes: number;
  /**
   * 等待使用者回應的工具（例如 AskUserQuestion）。這類工具從呼叫到結果之間是
   * 使用者的思考時間，不套用「工具執行中整段計入」的例外，而是照一般閒置規則。
   */
  interactiveTools?: readonly string[];
  /**
   * 工具執行例外的上限（分鐘），用於沒有 `timeout` 參數的工具。
   * 有 `timeout`（毫秒）的工具以其值加 1 分鐘為上限。
   */
  maxToolMinutes?: number;
}

export const DEFAULT_INTERACTIVE_TOOLS = ['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'];
export const DEFAULT_MAX_TOOL_MINUTES = 120;

interface Window {
  start: number;
  end: number;
}

/**
 * 找出「Claude 正在執行工具」的時段：非互動工具的 tool_use 到正常回傳的 tool_result。
 *
 * - 沒有 tool_result，或結果為錯誤（例如應用程式關閉後才補寫的「interrupted」），
 *   無法得知實際執行多久，不視為執行中。
 * - 時段長度以工具的 timeout（或 maxToolMinutes）為上限，避免等待權限核准、
 *   睡眠中的電腦等情況被整段計入。
 */
function toolWindows(events: readonly TranscriptEvent[], interactive: Set<string>, maxToolMs: number): Window[] {
  const uses = new Map<string, TranscriptEvent>();
  const windows: Window[] = [];
  for (const e of events) {
    if (e.role === 'tool_use' && e.toolUseId && !(e.toolName && interactive.has(e.toolName))) {
      uses.set(e.toolUseId, e);
    } else if (e.role === 'tool_result' && e.toolUseId && !e.isError) {
      const u = uses.get(e.toolUseId);
      if (!u || e.ts <= u.ts) continue;
      const timeout = (u.toolInput as { timeout?: unknown } | undefined)?.timeout;
      const cap = typeof timeout === 'number' && timeout > 0 ? timeout + MIN : maxToolMs;
      windows.push({ start: u.ts, end: Math.min(e.ts, u.ts + cap) });
    }
  }
  return windows;
}

/** 合併重疊或相接的時段（平行的工具呼叫），回傳依起點排序、互不重疊的時段 */
function mergeWindows(windows: readonly Window[]): Window[] {
  const sorted = [...windows].sort((x, y) => x.start - y.start);
  const merged: Window[] = [];
  for (const w of sorted) {
    const last = merged.at(-1);
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

/** [a, b] 開頭被工具執行時段連續覆蓋的長度（merged 須為 mergeWindows 的結果） */
function coveredFromStart(a: number, b: number, merged: readonly Window[]): number {
  // 二分搜尋最後一個 start ≤ a 的時段
  let lo = 0;
  let hi = merged.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (merged[mid]!.start <= a) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return 0;
  return Math.max(0, Math.min(b, merged[idx]!.end) - a);
}

export interface DayActivity {
  date: string;
  /** 精確分鐘數（未四捨五入） */
  minutes: number;
  firstTs: number;
  lastTs: number;
}

const MIN = 60_000;

/**
 * 將 [start, end) 區間中計入的 `counted` 毫秒，依各日所占比例分配。
 */
function distribute(
  start: number,
  end: number,
  counted: number,
  tz: string,
  add: (date: string, ms: number, segStart: number, segEnd: number) => void,
): void {
  if (counted <= 0) return;
  const span = end - start;
  if (span <= 0) {
    add(localDate(start, tz), counted, start, end);
    return;
  }
  let cur = start;
  while (cur < end) {
    const boundary = Math.min(nextLocalMidnight(cur, tz), end);
    add(localDate(cur, tz), (counted * (boundary - cur)) / span, cur, boundary);
    cur = boundary;
  }
}

/**
 * 依相鄰事件的間隔計算每日活躍分鐘數。
 *
 * - 間隔 ≤ 閒置門檻：整段計入。
 * - 間隔 > 閒置門檻：只計入寬限時間。
 * - 例外：非互動工具的 tool_use 到 tool_result 之間（Claude 正在執行指令）整段計入。
 * - 跨午夜的間隔，依比例分到兩天。
 */
export function computeActiveTime(
  events: readonly TranscriptEvent[],
  opts: ActiveTimeOptions,
): DayActivity[] {
  const tz = opts.timezone;
  const threshold = opts.idleThresholdMinutes * MIN;
  const grace = opts.idleGraceMinutes * MIN;
  const interactive = new Set(opts.interactiveTools ?? DEFAULT_INTERACTIVE_TOOLS);

  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const windows = mergeWindows(
    toolWindows(sorted, interactive, (opts.maxToolMinutes ?? DEFAULT_MAX_TOOL_MINUTES) * MIN),
  );
  const days = new Map<string, DayActivity>();
  const touch = (date: string): DayActivity => {
    let d = days.get(date);
    if (!d) {
      d = { date, minutes: 0, firstTs: Infinity, lastTs: -Infinity };
      days.set(date, d);
    }
    return d;
  };
  // 沒有任何事件、只分到間隔時間的日子（例如對話隔兩天才回來的中間那天），記錄分配區段的起訖
  const segBounds = new Map<string, { start: number; end: number }>();
  const addMs = (date: string, ms: number, segStart: number, segEnd: number) => {
    touch(date).minutes += ms / MIN;
    const b = segBounds.get(date);
    segBounds.set(date, { start: Math.min(b?.start ?? Infinity, segStart), end: Math.max(b?.end ?? -Infinity, segEnd) });
  };

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    const d = touch(localDate(e.ts, tz));
    d.firstTs = Math.min(d.firstTs, e.ts);
    d.lastTs = Math.max(d.lastTs, e.ts);

    const next = sorted[i + 1];
    if (!next) break;
    const gap = next.ts - e.ts;
    if (gap <= 0) continue;
    // 工具執行中的部分整段計入；其餘依閒置規則
    const covered = coveredFromStart(e.ts, next.ts, windows);
    const rest = gap - covered;
    const counted = covered + (rest <= threshold ? rest : Math.min(grace, rest));
    distribute(e.ts, next.ts, counted, tz, addMs);
  }

  const result: DayActivity[] = [];
  for (const d of days.values()) {
    if (Number.isFinite(d.firstTs)) {
      result.push(d);
    } else if (d.minutes >= 1) {
      // 例如長時間的建置跨越整天：以分配區段作為首末活動時間
      const b = segBounds.get(d.date)!;
      result.push({ ...d, firstTs: b.start, lastTs: b.end });
    }
    // 不足 1 分鐘、且當天沒有任何事件：只是閒置寬限的零頭，不建立任務日
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/** 規格 6.2 第 6 點：分鐘數換算時數並依 rounding 四捨五入 */
export function roundHours(minutes: number, rounding: number): number {
  if (rounding <= 0) return minutes / 60;
  const h = Math.round(minutes / 60 / rounding) * rounding;
  return Math.round(h * 100) / 100;
}
