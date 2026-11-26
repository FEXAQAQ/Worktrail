/**
 * commit 歸屬：同一個 repo 常有多個對話同時進行，單靠時間窗會把別的對話的 commit
 * 也算進來。優先以對話中 `git commit` 的輸出判斷是哪個對話做的 commit。
 */
import type { TranscriptEvent } from '../transcript/index.js';
import type { GitCommit } from './git.js';

/** `git commit` 成功時的輸出：`[branch abc1234] message`、`[main (root-commit) abc1234] msg` */
const COMMIT_OUTPUT_RE = /^\[[^\]\n]*?\b([0-9a-f]{7,40})\] /gm;

/** `git log --oneline -1` 的輸出：`abc1234 message`（常接在 `git commit -q` 之後） */
const ONELINE_RE = /^([0-9a-f]{7,40}) \S/m;

/** 指令中有實際執行 git commit（排除 --dry-run） */
const GIT_COMMIT_CMD_RE = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+commit\b(?![^\n;&|]*--dry-run)/;

/** 從本對話的工具結果中找出 commit 的 sha（複製自原對話的歷史不算） */
export function committedShas(events: readonly TranscriptEvent[]): string[] {
  const commitCalls = new Set<string>();
  for (const e of events) {
    const cmd = (e.toolInput as { command?: unknown } | undefined)?.command;
    if (e.role === 'tool_use' && e.toolUseId && typeof cmd === 'string' && GIT_COMMIT_CMD_RE.test(cmd)) {
      commitCalls.add(e.toolUseId);
    }
  }
  const shas = new Set<string>();
  for (const e of events) {
    if (e.role !== 'tool_result' || e.copied || e.isError || !e.text) continue;
    for (const m of e.text.matchAll(COMMIT_OUTPUT_RE)) shas.add(m[1]!);
    // `git commit -q && git log --oneline -1`：只採用 git commit 呼叫中的第一行，避免把列出的舊 commit 也算進來
    if (e.toolUseId && commitCalls.has(e.toolUseId)) {
      const m = ONELINE_RE.exec(e.text);
      if (m) shas.add(m[1]!);
    }
  }
  return [...shas];
}

const sameSha = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

export interface AttributeOptions {
  /** 本對話 git commit 輸出中的 sha */
  evidence: readonly string[];
  /** 已被其他對話以 git commit 輸出認領的 sha */
  claimedElsewhere?: readonly string[];
  /** 本對話的活動時段（無證據時只採用落在其中的 commit） */
  activeSpans: readonly { start: number; end: number }[];
}

export function attributeCommits(commits: readonly GitCommit[], opts: AttributeOptions): GitCommit[] {
  if (opts.evidence.length) {
    return commits.filter((c) => opts.evidence.some((s) => sameSha(s, c.sha)));
  }
  // 沒有證據（例如使用者在 IDE 手動 commit）：排除別的對話認領的，並限定在活動時段內
  const claimed = opts.claimedElsewhere ?? [];
  return commits.filter(
    (c) =>
      !claimed.some((s) => sameSha(s, c.sha)) && opts.activeSpans.some((sp) => c.ts >= sp.start && c.ts <= sp.end),
  );
}

/**
 * 將事件切成活動時段：相鄰事件間隔超過 gapMs 時斷開。
 * 時段結尾延長 tailMs，涵蓋最後一則訊息後不久的手動 commit。
 */
export function activeSpans(
  events: readonly TranscriptEvent[],
  gapMs: number,
  tailMs: number,
): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const e of events) {
    const last = spans.at(-1);
    if (last && e.ts - last.end <= gapMs) last.end = Math.max(last.end, e.ts);
    else spans.push({ start: e.ts, end: e.ts });
  }
  return spans.map((s) => ({ start: s.start, end: s.end + tailMs }));
}
