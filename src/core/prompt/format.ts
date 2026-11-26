/**
 * 規格 9.4：把資料整理成 Markdown，填入 {{records}}、{{stats}}、{{draft}}、{{previous_items}}。
 */
import { WEEKDAY_ZH, weekday } from '../period/index.js';
import { ITEM_STATUS_LABELS, ITEM_STATUSES, type Item, type Task } from '../schema/task.js';
import type { Stats } from '../stats/index.js';
import { groupMerged } from '../sync/task-merge.js';

const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1).replace(/\.0$/, '')}h`;

export function formatItem(i: Item): string {
  return `- [${ITEM_STATUS_LABELS[i.status]}] ${i.text}${i.note ? `（${i.note}）` : ''}`;
}

export function formatItems(items: readonly Item[]): string {
  return items.map(formatItem).join('\n');
}

type RecordTask = Pick<Task, 'date' | 'project' | 'ticket' | 'title' | 'hours' | 'items' | 'body' | 'merged'>;

const quote = (body: string, indent = '') => `${indent}> ${body.trim().replace(/\n/g, `\n${indent}> `)}`;

/** 週報的 {{records}}：依日期列出任務與子項 */
export function formatRecords(tasks: readonly RecordTask[]): string {
  if (!tasks.length) return '（本期間沒有工作紀錄）';
  const byDate = new Map<string, RecordTask[]>();
  for (const t of tasks) (byDate.get(t.date) ?? byDate.set(t.date, []).get(t.date)!).push(t);
  const out: string[] = [];
  for (const [date, list] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`### ${date}（${WEEKDAY_ZH[weekday(date)]}）`);
    for (const e of groupMerged(list)) {
      if (e.kind === 'group') {
        // 合併紀錄：一個專案標題，底下依任務列出子項
        out.push(`#### ${e.project}｜${fmtHours(e.hours)}（合併 ${e.tasks.length} 個任務）`);
        for (const t of e.tasks) {
          out.push(`- ${[t.ticket, t.title].filter(Boolean).join(' ') || '(無標題)'}｜${fmtHours(t.hours)}`);
          if (t.items.length) for (const i of t.items) out.push(`  ${formatItem(i)}`);
          else out.push('  - （尚未撰寫摘要）');
          if (t.body.trim()) out.push(quote(t.body, '  '));
        }
        continue;
      }
      const t = e.task;
      const head = [t.project || '(未分類)', [t.ticket, t.title].filter(Boolean).join(' ') || '(無標題)', fmtHours(t.hours)];
      out.push(`#### ${head.join('｜')}`);
      if (t.items.length) out.push(formatItems(t.items));
      else out.push('- （尚未撰寫摘要）');
      if (t.body.trim()) out.push(quote(t.body));
    }
    out.push('');
  }
  return out.join('\n').trim();
}

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

/** {{stats}}：統計數字表 */
export function formatStats(s: Stats): string {
  const lines = [
    '| 項目 | 數值 |',
    '| --- | --- |',
    `| 總時數 | ${fmtHours(s.total_hours)} |`,
    `| 工作天數 | ${s.days_worked} |`,
    `| 任務數 | ${s.task_count} |`,
    `| 單號數 | ${s.ticket_count} |`,
    `| 完成率 | ${pct(s.completion_rate)} |`,
    `| 子項狀態 | ${ITEM_STATUSES.map((k) => `${ITEM_STATUS_LABELS[k]} ${s.items_by_status[k]}`).join('、')} |`,
  ];
  if (s.hours_by_project.length) {
    lines.push('', '**各專案時數**', '', '| 專案 | 時數 | 占比 |', '| --- | --- | --- |');
    for (const p of s.hours_by_project) lines.push(`| ${p.project} | ${fmtHours(p.hours)} | ${pct(p.ratio)} |`);
  }
  if (s.hours_by_ticket.length) {
    lines.push('', '**各單號時數**', '', '| 單號 | 標題 | 時數 |', '| --- | --- | --- |');
    for (const t of s.hours_by_ticket) lines.push(`| ${t.ticket} | ${t.title} | ${fmtHours(t.hours)} |`);
  }
  if (s.open_items.length) {
    lines.push('', '**期末未完成項目**', '');
    for (const i of s.open_items) lines.push(`- [${ITEM_STATUS_LABELS[i.status]}] ${i.ticket ?? ''} ${i.text}${i.note ? `（${i.note}）` : ''}`.replace('  ', ' '));
  }
  return lines.join('\n');
}

/** 摘要範本的 {{draft}}；手動任務沒有對話紀錄，不列分支、活躍時間與 commit */
export function formatDraft(
  t: Pick<Task, 'ticket' | 'related_tickets' | 'project' | 'title' | 'active_minutes' | 'hours' | 'commits' | 'branch' | 'first_activity' | 'last_activity' | 'date' | 'manual'>,
): string {
  if (t.manual) {
    return [
      `- 日期：${t.date}`,
      `- 單號：${t.ticket ?? '（未辨識）'}`,
      `- 專案：${t.project || '（未指定）'}`,
      `- 標題：${t.title || '（無）'}`,
      `- 時數：${fmtHours(t.hours)}（使用者填寫）`,
    ].join('\n');
  }
  const lines = [
    `- 日期：${t.date}`,
    `- 單號：${t.ticket ?? '（未辨識）'}${t.related_tickets.length ? `（相關：${t.related_tickets.join('、')}）` : ''}`,
    `- 專案：${t.project || '（未對應）'}`,
    `- 標題候選：${t.title || '（無）'}`,
    `- 分支：${t.branch || '（無）'}`,
    `- 活動時段：${t.first_activity?.slice(11, 16) ?? '?'}–${t.last_activity?.slice(11, 16) ?? '?'}`,
    `- 系統計算的活躍時間：${t.active_minutes} 分鐘（約 ${fmtHours(t.hours)}，僅計對話中的活動）`,
  ];
  if (t.commits.length) {
    lines.push('- 今日 commit：');
    for (const c of t.commits) lines.push(`  - ${c.sha} ${c.message}`);
  } else {
    lines.push('- 今日 commit：無');
  }
  return lines.join('\n');
}

export { fmtHours };
