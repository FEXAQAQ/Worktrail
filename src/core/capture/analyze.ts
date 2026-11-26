/**
 * 將一個 session 的紀錄檔整理成每日任務草稿（擷取欄位 + 共用欄位預設值）。
 * 純函式：git commit 由呼叫端取得後傳入。
 */
import type { Config } from '../schema/config.js';
import type { ParsedTranscript } from '../transcript/index.js';
import { computeActiveTime, roundHours } from './active-time.js';
import { activeSpans, attributeCommits, committedShas } from './commits.js';
import type { GitCommit } from './git.js';
import { resolveProject } from './project.js';
import type { TicketCache } from '../ticket-info/index.js';
import { scoreTickets, type TicketScore } from './ticket.js';
import { pickTitle, type TitleCandidate } from './title.js';
import { localDate, toIsoInTz } from './tz.js';

export interface DayDraft {
  date: string;
  active_minutes: number;
  hours: number;
  first_activity: string;
  last_activity: string;
  commits: { sha: string; message: string }[];
}

export interface SessionDraft {
  session_id: string;
  repo: string;
  branch: string;
  ticket: string | null;
  related_tickets: string[];
  ticket_scores: TicketScore[];
  project: string;
  project_id?: string;
  project_unmapped: boolean;
  title: TitleCandidate | null;
  days: DayDraft[];
  /** 紀錄檔格式可能已變動的警訊 */
  warnings: string[];
}

export function analyzeSession(args: {
  parsed: ParsedTranscript;
  config: Config;
  /** repo 在 session 期間的 commit（尚未歸屬；由此函式依對話內容篩選） */
  commits?: readonly GitCommit[];
  /** 已被其他 session 以 git commit 輸出認領的 sha */
  claimedElsewhere?: readonly string[];
  /** 紀錄檔沒有 sessionId 時使用（例如由檔名取得） */
  sessionIdFallback?: string;
  /** 單號資訊快取（父卡片規則用） */
  ticketCache?: TicketCache;
}): SessionDraft {
  const { parsed, config } = args;
  const tz = config.time.timezone;
  const warnings: string[] = [];

  if (parsed.badLines > 0) warnings.push(`${parsed.badLines} 行無法解析為 JSON`);
  if (parsed.events.length === 0) warnings.push('找不到任何對話事件，紀錄檔格式可能已變動');

  // 分叉對話中複製自原對話的訊息，不計入本 session 的時間與 commit
  const ownEvents = parsed.events.filter((e) => !e.copied);
  const copiedCount = parsed.events.length - ownEvents.length;
  if (copiedCount > 0) warnings.push(`分叉對話：${copiedCount} 個事件複製自原對話，不計入時數`);

  const idleMs = config.time.idle_threshold_minutes * 60_000;
  const commits = attributeCommits(args.commits ?? [], {
    evidence: committedShas(ownEvents),
    claimedElsewhere: args.claimedElsewhere,
    activeSpans: activeSpans(ownEvents, idleMs, idleMs),
  });

  const tickets = scoreTickets({
    events: parsed.events,
    branches: parsed.meta.branches,
    commitMessages: commits.map((c) => c.message),
    keys: config.ticket.keys,
  });

  const project = resolveProject({
    cwd: parsed.meta.cwd,
    ticket: tickets.ticket,
    rules: config.projects,
    ticketInfo: tickets.ticket ? args.ticketCache?.[tickets.ticket.toUpperCase()] : undefined,
  });

  const title = pickTitle({
    events: parsed.events,
    ticket: tickets.ticket,
    customTitle: parsed.meta.customTitle,
  });

  const days = computeActiveTime(ownEvents, {
    timezone: tz,
    idleThresholdMinutes: config.time.idle_threshold_minutes,
    idleGraceMinutes: config.time.idle_grace_minutes,
  }).map<DayDraft>((d) => {
    const minutes = Math.round(d.minutes);
    return {
      date: d.date,
      active_minutes: minutes,
      hours: roundHours(minutes, config.time.rounding),
      first_activity: toIsoInTz(d.firstTs, tz),
      last_activity: toIsoInTz(d.lastTs, tz),
      commits: commits
        .filter((c) => localDate(c.ts, tz) === d.date)
        .map((c) => ({ sha: c.sha, message: c.message })),
    };
  });

  return {
    session_id: parsed.meta.sessionId ?? args.sessionIdFallback ?? '',
    repo: parsed.meta.cwd ?? '',
    branch: parsed.meta.branches.at(-1) ?? '',
    ticket: tickets.ticket,
    related_tickets: tickets.related,
    ticket_scores: tickets.scores,
    project: project.project,
    project_id: project.project_id,
    project_unmapped: project.unmapped,
    title,
    days,
    warnings,
  };
}
