/**
 * 首次引導（見 DECISIONS「首次引導」）：Jira 專案代碼的候選清單、勾選結果寫回設定、報告期間預覽。
 */
import { suggestTicketKeys, tasksMentioningKey, type TicketKeySuggestion } from '../capture/ticket.js';
import { performancePeriodOf, periodId, weeklyPeriodOf, type Period } from '../period/index.js';
import type { Config } from '../schema/config.js';

const KEY_RE = /^[A-Z][A-Z0-9]+$/;

export interface TicketKeyChoice {
  key: string;
  /** 已在設定中（例如預設的 TDDA） */
  current: boolean;
  /** 近期任務中提到這個代碼的任務數 */
  tasks: number;
  /** 偵測到的例子；設定中的代碼沒有出現時省略 */
  example?: TicketKeySuggestion['example'];
}

type KeyTask = { branch: string; title: string; ticket: string | null; commits: readonly { message: string }[] };

/**
 * 引導頁的 Jira 代碼清單：設定中的代碼＋近期任務偵測到的新代碼，以及預先勾選的代碼。
 * - 偵測到的新代碼預先勾選。
 * - 設定中的代碼近期有出現才預先勾選，讓預設的 TDDA 對其他團隊不會被默默保留；
 *   但近期完全沒有任何代碼可勾時，保留設定中的代碼（可能只是還沒有紀錄）。
 */
export function ticketKeyChoices(
  tasks: readonly KeyTask[],
  keys: readonly string[],
  ignored: readonly string[] = [],
): { choices: TicketKeyChoice[]; selected: string[] } {
  const count = (key: string) => {
    const prefix = `${key}-`;
    const mentioned = new Set(tasksMentioningKey(tasks, key));
    return tasks.filter((t) => mentioned.has(t) || t.ticket?.toUpperCase().startsWith(prefix)).length;
  };
  const current: TicketKeyChoice[] = keys.map((key) => ({ key, current: true, tasks: count(key) }));
  const suggested: TicketKeyChoice[] = suggestTicketKeys(tasks, keys, ignored).map((s) => ({
    key: s.key,
    current: false,
    tasks: s.tasks,
    example: s.example,
  }));
  const choices = [...current, ...suggested];
  let selected = choices.filter((c) => !c.current || c.tasks > 0).map((c) => c.key);
  if (!selected.length) selected = [...keys];
  return { choices, selected };
}

/** 把使用者輸入的代碼整理成大寫、去重；不合格式的略過 */
export function normalizeTicketKeys(input: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const k = raw.trim().toUpperCase().replace(/-+$/, '');
    if (KEY_RE.test(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

type TicketSettings = { keys: string[]; ignored_keys: string[] };

/**
 * 引導頁送出勾選結果：勾選的成為 `ticket.keys`；列出來卻沒勾的偵測代碼記到 `ignored_keys`，
 * 今日頁不會再詢問。設定中原有、這次沒勾的代碼只移除，不列入忽略。
 */
export function applyTicketKeySelection<T extends TicketSettings>(
  ticket: T,
  selected: readonly string[],
  offered: readonly string[],
): { ticket: T; changed: string[] } {
  const keys = normalizeTicketKeys(selected);
  const ignoredAdd = normalizeTicketKeys(offered).filter((k) => !keys.includes(k) && !ticket.keys.includes(k));
  const ignored_keys = [...new Set([...ticket.ignored_keys, ...ignoredAdd])].filter((k) => !keys.includes(k));
  const changed = [...keys.filter((k) => !ticket.keys.includes(k)), ...ticket.keys.filter((k) => !keys.includes(k))];
  return { ticket: { ...ticket, keys, ignored_keys }, changed };
}

export interface PeriodPreview {
  weekly: Period & { id: string };
  /** 自訂績效期間沒有固定的本期 */
  performance: (Period & { id: string }) | null;
}

/** 依報告設定算出「今天」所在的週報與績效期間，讓使用者確認切法 */
export function previewPeriods(config: Config, today: string): PeriodPreview {
  const w = weeklyPeriodOf(today, config.report.weekly);
  const { period: kind, year_start_month: ysm } = config.report.performance;
  const p = kind === 'custom' ? null : performancePeriodOf(today, kind, ysm);
  return {
    weekly: { ...w, id: periodId('weekly', w, config) },
    performance: p ? { ...p, id: periodId('performance', p, config) } : null,
  };
}
