/**
 * 規格 11.4「日誌」：年度熱度圖、依日期分組的任務清單、篩選、任務編輯面板。
 * 版型比照週報／績效／小交流：左欄月份清單；右欄熱度圖、篩選與當月任務（見 DECISIONS.md）。
 */
import { useQuery } from '@tanstack/react-query';
import { NotebookPen, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, type ItemStatus, type Task } from '../lib/api';
import { useHotkey } from '../lib/app';
import { STATUS_LABEL, STATUS_ORDER, addDays, fmtHours, formatDateLong, todayStr } from '../lib/format';
import { Heatmap } from '../components/Heatmap';
import { flattenEntries, groupEntries, MergeSuggestions, TaskEntries } from '../components/MergedGroup';
import { TaskPanel } from '../components/TaskPanel';
import { useOpenTask } from '../lib/useOpenTask';
import { NewTaskButton } from '../components/NewTaskDialog';
import { Button, Card, cx, EmptyState, PageTitle, Select, Skeleton } from '../components/ui';

/** J／K 在清單中上下移動，Enter 開啟（規格 11.5） */
export function useListNavigation(tasks: Task[], open: (id: string) => void, active: boolean) {
  const [selected, setSelected] = useState<string | null>(null);
  const move = (d: number) => {
    if (!active || !tasks.length) return;
    const idx = tasks.findIndex((t) => t.id === selected);
    const next = tasks[Math.max(0, Math.min(tasks.length - 1, idx < 0 ? 0 : idx + d))]!;
    setSelected(next.id);
    document.querySelector(`[data-task-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  useHotkey('j', () => move(1));
  useHotkey('k', () => move(-1));
  useHotkey('Enter', () => active && selected && open(selected));
  return { selected };
}

const monthLabel = (m: string) => `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`;
const round1 = (h: number) => Math.round(h * 10) / 10;

interface MonthInfo {
  id: string;
  tasks: number;
  hours: number;
  days: number;
}

export function LogPage() {
  const today = todayStr();
  const [params, setParams] = useSearchParams();
  const [openId, setOpen] = useOpenTask();
  const date = params.get('date');
  const [project, setProject] = useState('');
  const [ticket, setTicket] = useState('');
  const [itemStatus, setItemStatus] = useState<ItemStatus | ''>('');

  const year = useQuery({ queryKey: ['tasks', 'year', today], queryFn: () => get<{ tasks: Task[] }>(`/api/tasks?from=${addDays(today, -371)}&to=${today}`) });
  const all = year.data?.tasks ?? [];

  const hoursByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of all) m.set(t.date, (m.get(t.date) ?? 0) + t.hours);
    return m;
  }, [all]);
  const yearHours = round1([...hoursByDate.values()].reduce((a, b) => a + b, 0));

  /** 左欄月份清單（本月即使還沒有紀錄也列出） */
  const months = useMemo<MonthInfo[]>(() => {
    const m = new Map<string, { tasks: number; hours: number; days: Set<string> }>([[today.slice(0, 7), { tasks: 0, hours: 0, days: new Set() }]]);
    for (const t of all) {
      const k = t.date.slice(0, 7);
      const v = m.get(k) ?? m.set(k, { tasks: 0, hours: 0, days: new Set() }).get(k)!;
      v.tasks++;
      v.hours += t.hours;
      v.days.add(t.date);
    }
    return [...m].sort(([a], [b]) => b.localeCompare(a)).map(([id, v]) => ({ id, tasks: v.tasks, hours: round1(v.hours), days: v.days.size }));
  }, [all, today]);
  const month = date?.slice(0, 7) ?? params.get('month') ?? today.slice(0, 7);
  const monthInfo = months.find((m) => m.id === month);

  const projects = useMemo(() => [...new Set(all.map((t) => t.project).filter(Boolean))].sort(), [all]);
  const tickets = useMemo(() => [...new Set(all.map((t) => t.ticket).filter(Boolean) as string[])].sort(), [all]);

  const visible = all.filter(
    (t) =>
      (date ? t.date === date : t.date.startsWith(month)) &&
      (!project || t.project === project) &&
      (!ticket || t.ticket === ticket) &&
      (!itemStatus || t.items.some((i) => i.status === itemStatus)),
  );
  const filtering = !!(date || project || ticket || itemStatus);

  const groups = useMemo(() => {
    const g = new Map<string, Task[]>();
    for (const t of visible) (g.get(t.date) ?? g.set(t.date, []).get(t.date)!).push(t);
    return [...g].sort(([a], [b]) => b.localeCompare(a)).map(([d, ts]) => [d, ts, groupEntries(ts)] as const);
  }, [visible]);

  const flat = groups.flatMap(([, , es]) => flattenEntries(es));
  const { selected } = useListNavigation(flat, setOpen, !openId);

  useEffect(() => {
    if (date) document.getElementById(`day-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [date]);

  const pickDate = (d: string | null) => {
    const p = new URLSearchParams(params);
    if (d && d !== date) {
      p.set('date', d);
      p.set('month', d.slice(0, 7));
    } else p.delete('date');
    setParams(p);
  };
  const pickMonth = (m: string) => {
    const p = new URLSearchParams(params);
    p.delete('date');
    p.set('month', m);
    setParams(p);
  };
  const clearFilters = () => {
    setProject('');
    setTicket('');
    setItemStatus('');
    pickDate(null);
  };
  const newTask = <NewTaskButton date={date ?? undefined} onCreated={(t) => setOpen(t.id)} />;
  const dayCount = date ? all.filter((t) => t.date === date).length : 0;

  return (
    <div className="grid h-full gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      {/* 寬螢幕：左欄月份清單 */}
      <aside className="hidden min-w-0 xl:block">
        <div className="mb-4 flex items-center justify-between gap-2">
          <PageTitle>日誌</PageTitle>
          {newTask}
        </div>
        <Card className="overflow-hidden">
          {year.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-240px)] overflow-auto py-1" role="listbox" aria-label="月份">
              {months.map((m) => (
                <li key={m.id} role="option" aria-selected={m.id === month}>
                  <button
                    type="button"
                    onClick={() => pickMonth(m.id)}
                    className={cx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-hover', m.id === month && 'bg-accent-soft')}
                  >
                    <div className="min-w-0">
                      <div className={cx('font-medium', m.id === month && 'text-accent')}>{m.id}</div>
                      <div className="truncate text-xs text-ink-3">{m.days ? `${m.days} 天有紀錄` : '尚無紀錄'}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className="text-ink-2">{fmtHours(m.hours)}</div>
                      <div className="text-ink-3">{m.tasks} 任務</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>

      <section className="min-w-0">
        {/* 較窄的視窗：頂部月份選單 */}
        <div className="mb-5 flex flex-wrap items-center gap-2 xl:hidden">
          <PageTitle className="mr-2">日誌</PageTitle>
          <Select aria-label="月份" className="min-w-0 max-w-full flex-1 sm:flex-none" value={month} onChange={(e) => pickMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}・{fmtHours(m.hours)}・{m.tasks} 任務
              </option>
            ))}
          </Select>
          {newTask}
        </div>

        <div className="mb-4">
          <div className="text-lg font-bold">{date ? formatDateLong(date) : monthLabel(month)}</div>
          <div className="text-xs text-ink-3">
            {date
              ? `${fmtHours(round1(hoursByDate.get(date) ?? 0))}・${dayCount} 個任務`
              : `${fmtHours(monthInfo?.hours ?? 0)}・${monthInfo?.tasks ?? 0} 個任務・過去一年共 ${fmtHours(yearHours)}、${all.length} 個任務`}
          </div>
        </div>

        <Card className="mb-4 p-4">{year.isLoading ? <Skeleton className="h-28" /> : <Heatmap end={today} hoursByDate={hoursByDate} selected={date} onPick={pickDate} />}</Card>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={project} onChange={(e) => setProject(e.target.value)} aria-label="專案">
            <option value="">所有專案</option>
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
          <Select value={ticket} onChange={(e) => setTicket(e.target.value)} aria-label="單號" className="font-mono">
            <option value="">所有單號</option>
            {tickets.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
          <Select value={itemStatus} onChange={(e) => setItemStatus(e.target.value as ItemStatus | '')} aria-label="子項狀態">
            <option value="">所有狀態</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                含「{STATUS_LABEL[s]}」
              </option>
            ))}
          </Select>
          {/* 摘要狀態不另外篩選：待補摘要集中在「待補摘要」頁 */}
          <Link to="/pending" className="px-1 text-sm text-ink-3 underline hover:text-ink">
            看待補摘要
          </Link>
          {date && (
            <Button variant="soft" onClick={() => pickDate(null)} aria-label={`清除日期 ${date}`}>
              {date} <X className="size-3.5" />
            </Button>
          )}
          {filtering && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              清除篩選
            </Button>
          )}
        </div>

        {year.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<NotebookPen className="size-8" />}
            title={filtering ? '沒有符合篩選條件的任務' : all.length ? `${monthLabel(month)}沒有工作紀錄` : '還沒有任何工作紀錄'}
          >
            {filtering
              ? '試試看清除篩選條件。'
              : all.length
                ? '從月份清單選其他月份，或點熱度圖上的日期。'
                : '安裝完成後，在 Claude Code 中完成一個任務，日誌就會出現在這裡。若一直沒有紀錄，請到設定 → 整合檢查安裝狀態。'}
          </EmptyState>
        ) : (
          <div className="space-y-8">
            {groups.map(([d, ts, es]) => (
              <section key={d} id={`day-${d}`}>
                <div className="sticky top-0 z-(--z-sticky) -mx-1 mb-2 flex flex-wrap items-center gap-x-3 bg-page/90 px-1 py-1 backdrop-blur">
                  <h2 className="text-sm font-semibold">{formatDateLong(d)}</h2>
                  {/* 依當天全部任務判斷，不受篩選影響 */}
                  <MergeSuggestions tasks={all.filter((t) => t.date === d)} />
                  <span className="ml-auto text-xs text-ink-3">{fmtHours(round1(ts.reduce((a, t) => a + t.hours, 0)))}</span>
                </div>
                <TaskEntries entries={es} onOpen={setOpen} selected={selected} />
              </section>
            ))}
          </div>
        )}
      </section>

      {openId && <TaskPanel taskId={openId} onClose={() => setOpen(null)} onIdChange={(id) => setOpen(id)} />}
    </div>
  );
}
