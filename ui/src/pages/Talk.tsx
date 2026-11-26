/**
 * 小交流：勾選幾天的工作紀錄，整理成一眼看懂的簡短重點（規格未涵蓋，見 DECISIONS.md）。
 * 左欄清單；右欄日期勾選、範本、產生、Markdown 編輯器。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronLeft, ChevronRight, Columns2, Copy, Download, Eye, MessagesSquare, Pencil, Plus, Sparkles, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, get, post, put, type PromptInfo, type Stats, type Talk, type TalkListItem, type Task } from '../lib/api';
import { useDebounced, useJobs, useRunningJob, useToast } from '../lib/app';
import { addDays, download, fmtHours, formatDateShort, todayStr, weekdayOf } from '../lib/format';
import { Editor, MarkdownView } from '../components/Editor';
import { SnapshotButton } from '../components/ShareCard';
import { Banner, Button, Card, Confirm, cx, EmptyState, IconButton, Input, LinkButton, PageTitle, Segmented, Select, Skeleton, Tag, TITLE_FIELD } from '../components/ui';
import { DOC_STATUS, PromptSelect, ReportTabs, useDocMode } from '../components/DocShared';

const STATUS = DOC_STATUS;

const datesSummary = (dates: string[]) => (dates.length ? dates.map(formatDateShort).join('、') : '尚未勾選日期');

function usePrompts() {
  return useQuery({ queryKey: ['prompts'], queryFn: () => get<{ prompts: PromptInfo[]; defaults: Record<string, string> }>('/api/prompts') });
}

export function TalkPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['talks'], queryFn: () => get<{ talks: TalkListItem[] }>('/api/talks') });
  const talks = list.data?.talks ?? [];
  const current = id ?? (list.isLoading ? undefined : talks[0]?.id ?? 'new');

  return (
    <div className="grid h-full gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden min-w-0 xl:block">
        <div className="mb-4 flex items-center justify-between gap-2">
          <PageTitle>報告</PageTitle>
          <Button icon={<Plus className="size-4" />} onClick={() => navigate('/talk/new')}>
            新增
          </Button>
        </div>
        <ReportTabs className="mb-3" />
        <Card className="overflow-hidden">
          {list.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-240px)] overflow-auto py-1" role="listbox" aria-label="小交流">
              {talks.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/talk/${t.id}`}
                    className={cx('flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-hover', t.id === current && 'bg-accent-soft')}
                    aria-selected={t.id === current}
                  >
                    <div className="min-w-0">
                      <div className={cx('truncate font-medium', t.id === current && 'text-accent')}>{t.title || `${t.created_at.slice(5, 10).replace('-', '/')} 小交流`}</div>
                      <div className="truncate text-xs text-ink-3">{datesSummary(t.dates)}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={STATUS[t.status].cls}>{STATUS[t.status].label}</div>
                      <div className="text-ink-3">{t.dates.length} 天</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>

      <section className="min-w-0">
        <div className="mb-5 flex flex-wrap items-center gap-2 xl:hidden">
          <PageTitle className="mr-2">報告</PageTitle>
          <ReportTabs className="mr-2 w-full sm:w-auto" />
          <Select aria-label="小交流" className="min-w-0 max-w-full flex-1 sm:flex-none" value={current ?? ''} onChange={(e) => navigate(`/talk/${e.target.value}`)}>
            <option value="new">＋ 新的小交流</option>
            {talks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title || t.id}（{datesSummary(t.dates)}）・{STATUS[t.status].label}
              </option>
            ))}
          </Select>
        </div>
        {!current ? <Skeleton className="h-96" /> : current === 'new' ? <NewTalk /> : <TalkDetail key={current} id={current} />}
      </section>
    </div>
  );
}

// ───────────── 新增

function NewTalk() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { track } = useJobs();
  const prompts = usePrompts();
  const [dates, setDates] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!prompt && prompts.data) setPrompt(prompts.data.defaults.talk ?? 'talk/default');
  }, [prompts.data, prompt]);

  const create = async (generate: boolean) => {
    setBusy(true);
    try {
      const { talk } = await post<{ talk: Talk }>('/api/talks', { dates, title: title || undefined });
      if (generate) {
        const r = await post<{ job_id: string }>(`/api/talks/${talk.id}/generate`, { prompt });
        track(r.job_id, (j) => {
          if (j.status === 'done') toast.show({ tone: 'success', message: '小交流重點已產生' });
          void qc.invalidateQueries({ queryKey: ['talk', talk.id] });
          void qc.invalidateQueries({ queryKey: ['talks'] });
        });
      }
      void qc.invalidateQueries({ queryKey: ['talks'] });
      navigate(`/talk/${talk.id}`, { replace: true });
    } catch (e) {
      toast.show({ tone: 'error', message: (e as Error).message });
      setBusy(false);
    }
  };

  const talkPrompts = (prompts.data?.prompts ?? []).filter((p) => p.type === 'talk');

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-bold">新的小交流</div>
        <div className="text-xs text-ink-3">勾選要報告的日子，Claude 會整理成一眼看懂這幾天在做什麼的簡短重點。寫法可在 Prompt 頁的「小交流」範本調整。</div>
      </div>
      <Card className="space-y-4 p-4">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="標題（選填），例如 11 月第 3 週小交流" aria-label="標題" />
        <DatePicker value={dates} onChange={setDates} />
        <SelectedTasks dates={dates} />
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <PromptSelect prompts={talkPrompts} value={prompt} onChange={setPrompt} />
        <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={!dates.length || busy} loading={busy} onClick={() => void create(true)}>
          產生重點
        </Button>
        <Button variant="ghost" disabled={!dates.length || busy} onClick={() => void create(false)}>
          建立後自己寫
        </Button>
        {!dates.length && <span className="text-xs text-ink-3">請先勾選至少一天</span>}
      </div>
    </div>
  );
}

// ───────────── 日期勾選

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

function monthDays(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

function shiftMonth(ym: string, d: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return t.toISOString().slice(0, 7);
}

function DatePicker({ value, onChange }: { value: string[]; onChange: (d: string[]) => void }) {
  const today = todayStr();
  const [month, setMonth] = useState(() => (value.length ? value[value.length - 1]! : today).slice(0, 7));
  const days = monthDays(month);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const monthTasks = useQuery({ queryKey: ['tasks', 'talk-cal', month], queryFn: () => get<{ tasks: Task[] }>(`/api/tasks?from=${from}&to=${to}`) });
  // 快速選取用：最近 60 天有紀錄的日子
  const recent = useQuery({ queryKey: ['tasks', 'talk-recent', today], queryFn: () => get<{ tasks: Task[] }>(`/api/tasks?from=${addDays(today, -60)}&to=${today}`) });

  const byDate = useMemo(() => {
    const m = new Map<string, { count: number; hours: number }>();
    for (const t of monthTasks.data?.tasks ?? []) {
      const v = m.get(t.date) ?? { count: 0, hours: 0 };
      m.set(t.date, { count: v.count + 1, hours: v.hours + t.hours });
    }
    return m;
  }, [monthTasks.data]);
  const recentDates = useMemo(() => [...new Set((recent.data?.tasks ?? []).map((t) => t.date))].sort().reverse(), [recent.data]);

  const selected = new Set(value);
  const toggle = (d: string) => onChange(selected.has(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  const lead = (weekdayOf(from) + 6) % 7; // 週一起算

  const thisWeekStart = addDays(today, -((weekdayOf(today) + 6) % 7));
  const quick: { label: string; dates: string[] }[] = [
    { label: '最近 1 天', dates: recentDates.slice(0, 1) },
    { label: '最近 3 天', dates: recentDates.slice(0, 3) },
    { label: '最近 5 天', dates: recentDates.slice(0, 5) },
    { label: '本週', dates: recentDates.filter((d) => d >= thisWeekStart) },
    { label: '上週', dates: recentDates.filter((d) => d >= addDays(thisWeekStart, -7) && d < thisWeekStart) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
      <div>
        <div className="mb-2 flex items-center gap-1">
          <IconButton onClick={() => setMonth(shiftMonth(month, -1))} aria-label="上個月">
            <ChevronLeft className="size-4" />
          </IconButton>
          <div className="flex-1 text-center text-sm font-semibold">
            {Number(month.slice(0, 4))} 年 {Number(month.slice(5, 7))} 月
          </div>
          <IconButton onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= today.slice(0, 7)} aria-label="下個月">
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="勾選日期">
          {WEEK_HEAD.map((w) => (
            <div key={w} className="pb-1 text-2xs text-ink-3">
              {w}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`b${i}`} />
          ))}
          {days.map((d) => {
            const info = byDate.get(d);
            const on = selected.has(d);
            const future = d > today;
            return (
              <button
                key={d}
                disabled={future}
                onClick={() => toggle(d)}
                aria-pressed={on}
                title={info ? `${info.count} 個任務・${fmtHours(info.hours)}` : '沒有紀錄'}
                className={cx(
                  'flex h-11 flex-col items-center justify-center rounded-ctl text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30',
                  on ? 'bg-accent text-on-accent' : info ? 'bg-accent-soft font-semibold text-ink hover:ring-1 hover:ring-accent' : 'text-ink-3 hover:bg-hover',
                  d === today && !on && 'ring-1 ring-line',
                )}
              >
                <span className="leading-none">{Number(d.slice(8))}</span>
                <span className={cx('mt-0.5 text-2xs leading-none', on ? 'opacity-90' : 'text-ink-3')}>{info ? fmtHours(info.hours) : ' '}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-2">快速選取（有紀錄的日子）</div>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <Button key={q.label} size="sm" disabled={!q.dates.length} onClick={() => onChange([...q.dates].sort())}>
                {q.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={!value.length} onClick={() => onChange([])}>
              清除
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-2">已勾選 {value.length} 天</div>
          <div className="flex flex-wrap gap-1.5">
            {value.length === 0 && <span className="text-xs text-ink-3">點選左側日曆的日期；有底色的是有工作紀錄的日子。</span>}
            {value.map((d) => (
              <Tag key={d} className="cursor-pointer" onClick={() => toggle(d)} title="點擊移除">
                {formatDateShort(d)} ✕
              </Tag>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 勾選日期上的任務（確認會納入哪些工作） */
function SelectedTasks({ dates }: { dates: string[] }) {
  const sorted = [...dates].sort();
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  const q = useQuery({ queryKey: ['tasks', 'talk-sel', from, to], queryFn: () => get<{ tasks: Task[] }>(`/api/tasks?from=${from}&to=${to}`), enabled: !!from });
  if (!dates.length) return null;
  const set = new Set(dates);
  const tasks = (q.data?.tasks ?? []).filter((t) => set.has(t.date)).sort((a, b) => a.date.localeCompare(b.date));
  const total = tasks.reduce((a, t) => a + t.hours, 0);
  return (
    <details className="rounded-ctl border border-line" open={tasks.length <= 8}>
      <summary className="cursor-pointer px-3 py-2 text-xs text-ink-2">
        會納入 {tasks.length} 個任務・{fmtHours(total)}
        {tasks.some((t) => t.summary_status !== 'done') && <span className="ml-2 text-warn">（有任務待補摘要，內容可能不完整）</span>}
      </summary>
      <ul className="divide-y divide-line border-t border-line text-sm">
        {q.isLoading && <li className="px-3 py-2 text-ink-3">載入中…</li>}
        {!q.isLoading && !tasks.length && <li className="px-3 py-2 text-ink-3">勾選的日期沒有任何任務紀錄</li>}
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-20 shrink-0 text-xs text-ink-3">{formatDateShort(t.date)}</span>
            {t.ticket && <span className="shrink-0 font-mono text-xs text-ink-2">{t.ticket}</span>}
            <span className="min-w-0 flex-1 truncate">{t.title || '（無標題）'}</span>
            <span className="shrink-0 text-xs text-ink-3">{fmtHours(t.hours)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ───────────── 內容

interface TalkDetailData {
  talk: Talk;
  stats: Stats;
  pending_summaries: number;
}

function TalkDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { track, cancel } = useJobs();
  const detail = useQuery({ queryKey: ['talk', id], queryFn: () => get<TalkDetailData>(`/api/talks/${id}`) });
  const prompts = usePrompts();
  const running = useRunningJob('generate', `talk/${id}`);

  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [editDates, setEditDates] = useState(false);
  const [mode, setMode] = useDocMode();
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved'>('');
  const [conflict, setConflict] = useState<Talk | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [writing, setWriting] = useState(false);
  const version = useRef<string | null>(null);
  const dirty = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const loaded = useRef(false);

  const talk = detail.data?.talk ?? null;
  useEffect(() => {
    if (!talk) return;
    if (!dirty.current || talk.version === version.current) {
      setText(talk.body);
      version.current = talk.version;
    }
    if (!loaded.current) {
      setTitle(talk.title);
      setDates(talk.dates);
      setEditDates(!talk.body.trim());
      loaded.current = true;
    }
  }, [talk]);
  useEffect(() => {
    if (!prompt && prompts.data) setPrompt(talk?.prompt && talk.prompt !== 'manual' ? talk.prompt : prompts.data.defaults.talk ?? 'talk/default');
  }, [prompts.data, talk, prompt]);

  /** 依序送出修改，避免內文、標題、日期同時儲存互相衝突 */
  const save = (patch: { content?: string; title?: string; dates?: string[] }, base?: string | null) => {
    const run = async () => {
      setSaveState('saving');
      try {
        const r = await put<{ talk: Talk }>(`/api/talks/${id}`, { ...patch, base_version: base ?? version.current });
        version.current = r.talk.version;
        if (patch.content !== undefined) dirty.current = false;
        setSaveState('saved');
        setConflict(null);
        qc.setQueryData<TalkDetailData>(['talk', id], (old) => (old ? { ...old, talk: r.talk } : old));
        void qc.invalidateQueries({ queryKey: ['talks'] });
        if (patch.dates) void qc.invalidateQueries({ queryKey: ['talk', id] });
      } catch (e) {
        setSaveState('');
        if (e instanceof ApiError && e.status === 409) setConflict(e.data?.talk ?? null);
        else toast.show({ tone: 'error', message: `儲存失敗：${(e as Error).message}` });
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  };
  const autosave = useDebounced((c: string) => void save({ content: c }), 600);
  const saveTitle = useDebounced((t: string) => void save({ title: t }), 600);

  const changeDates = (d: string[]) => {
    setDates(d);
    void save({ dates: d });
  };

  const generate = async (overwrite = false) => {
    if (!dates.length) {
      toast.show({ tone: 'error', message: '請至少勾選一天' });
      setEditDates(true);
      return;
    }
    try {
      autosave.cancel();
      await queue.current;
      const r = await post<{ job_id: string }>(`/api/talks/${id}/generate`, { prompt, overwrite, dates });
      track(r.job_id, (j) => {
        if (j.status === 'done') {
          dirty.current = false;
          setEditDates(false);
          toast.show({ tone: 'success', message: '小交流重點已產生' });
        }
        void qc.invalidateQueries({ queryKey: ['talk', id] });
        void qc.invalidateQueries({ queryKey: ['talks'] });
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConfirmOverwrite(true);
      else toast.show({ tone: 'error', message: (e as Error).message });
    }
  };

  const remove = async () => {
    try {
      const r = await del<{ trash_path: string }>(`/api/talks/${id}`);
      void qc.invalidateQueries({ queryKey: ['talks'] });
      navigate('/talk/new', { replace: true });
      toast.show({
        message: '已刪除',
        duration: 8000,
        action: {
          label: '復原',
          run: async () => {
            await post('/api/talks/restore', { trash_path: r.trash_path });
            void qc.invalidateQueries({ queryKey: ['talks'] });
            navigate(`/talk/${id}`);
          },
        },
      });
    } catch (e) {
      toast.show({ tone: 'error', message: (e as Error).message });
    }
  };

  if (detail.isLoading) return <Skeleton className="h-[600px]" />;
  if (detail.error || !detail.data || !talk) return <EmptyState title="無法載入">{(detail.error as Error)?.message}</EmptyState>;
  const d = detail.data;
  const talkPrompts = (prompts.data?.prompts ?? []).filter((p) => p.type === 'talk');
  const hasContent = !!talk.body.trim() || text.length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              saveTitle.run(e.target.value);
            }}
            onBlur={() => saveTitle.flush(title)}
            placeholder={`${talk.created_at.slice(5, 10).replace('-', '/')} 小交流（點此命名）`}
            className={cx(TITLE_FIELD, 'min-w-0')}
            aria-label="標題"
          />
          <div className="text-xs text-ink-3">
            {datesSummary(dates)}
            {talk.generated_at && `・${talk.edited ? '已手動編輯' : `由 ${talk.prompt} 產生`}`}
            {saveState === 'saving' && '・儲存中…'}
            {saveState === 'saved' && '・已儲存'}
          </div>
        </div>
        <PromptSelect prompts={talkPrompts} value={prompt} onChange={setPrompt} />
        {running ? (
          <Button variant="secondary" icon={<Square className="size-3.5" />} onClick={() => void cancel(running.id)}>
            {running.progress ?? '產生中…'}・取消
          </Button>
        ) : (
          <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void generate(false)}>
            {talk.generated_at ? '重新產生' : '產生重點'}
          </Button>
        )}
        <Button
          variant="ghost"
          icon={<Copy className="size-4" />}
          disabled={!text}
          onClick={() => {
            void navigator.clipboard.writeText(text);
            toast.show({ message: '已複製' });
          }}
        >
          複製
        </Button>
        <SnapshotButton
          disabled={!text}
          content={{ kind: '小交流', title: title || `${talk.created_at.slice(5, 10).replace('-', '/')} 小交流`, subtitle: datesSummary(dates), stats: d.stats, text }}
        />
        <Button variant="ghost" icon={<Download className="size-4" />} disabled={!text} onClick={() => download(`小交流-${id}.md`, text)}>
          下載 .md
        </Button>
        <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void remove()} aria-label="刪除" />
      </div>

      {talk.stale && (
        <Banner tone="warn">
          勾選的日期或其中的工作紀錄在產生後有變動。
          <LinkButton onClick={() => void generate(false)}>
            重新產生
          </LinkButton>
        </Banner>
      )}
      {d.pending_summaries > 0 && (
        <Banner tone="info">
          勾選的日期有 {d.pending_summaries} 個任務待補摘要，產生前建議先到
          <Link to="/pending" className="mx-1 underline">
            待補摘要頁
          </Link>
          補寫。
        </Banner>
      )}
      {conflict && (
        <Banner tone="warn">
          此內容已在別處更新。
          <LinkButton onClick={() => void save({ content: text }, conflict.version)}>
            保留我的
          </LinkButton>
          <LinkButton
            className="font-normal"
            onClick={() => {
              setText(conflict.body);
              version.current = conflict.version;
              dirty.current = false;
              setConflict(null);
            }}
          >
            使用最新
          </LinkButton>
        </Banner>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <CalendarCheck className="size-4 text-accent" />
          <div className="text-sm font-semibold">報告日期</div>
          <div className="min-w-0 flex-1 truncate text-xs text-ink-3">
            {dates.length} 天・{d.stats.task_count} 任務・{fmtHours(d.stats.total_hours)}
          </div>
          <Button size="sm" onClick={() => setEditDates((v) => !v)}>
            {editDates ? '收合' : '修改日期'}
          </Button>
        </div>
        {editDates && (
          <div className="mt-4 space-y-4">
            <DatePicker value={dates} onChange={changeDates} />
            <SelectedTasks dates={dates} />
          </div>
        )}
      </Card>

      <Card className="flex min-h-[480px] flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-1 border-b border-line px-3 py-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'edit', label: '編輯', icon: <Pencil className="size-3.5" /> },
              { value: 'preview', label: '預覽', icon: <Eye className="size-3.5" /> },
              { value: 'split', label: '並排', icon: <Columns2 className="size-3.5" /> },
            ]}
          />
        </div>
        {!hasContent && !running && !writing ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={<MessagesSquare className="size-8" />}
              title="尚未產生重點"
              action={
                <div className="flex gap-2">
                  <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void generate(false)}>
                    以「{talkPrompts.find((p) => p.ref === prompt)?.title ?? prompt}」產生
                  </Button>
                  <Button
                    onClick={() => {
                      setWriting(true);
                      setMode('edit');
                    }}
                  >
                    直接撰寫
                  </Button>
                </div>
              }
            >
              由勾選日期的每日任務整理成簡短重點。
            </EmptyState>
          </div>
        ) : (
          <div className={cx('grid min-h-0 flex-1', mode === 'split' && 'lg:grid-cols-2')}>
            {(mode === 'edit' || mode === 'split') && (
              <div className={cx('min-h-0 overflow-auto', mode === 'split' && 'border-r border-line')}>
                <Editor
                  value={text}
                  onChange={(v) => {
                    setText(v);
                    dirty.current = true;
                    autosave.run(v);
                  }}
                  onBlur={() => dirty.current && autosave.flush(text)}
                />
              </div>
            )}
            {mode !== 'edit' && (
              <div className="min-h-0 overflow-auto px-6 py-5">
                {running && !text ? <div className="text-sm text-ink-3">{running.progress ?? '產生中…'}</div> : <MarkdownView text={text} />}
              </div>
            )}
          </div>
        )}
      </Card>

      <Confirm
        open={confirmOverwrite}
        onClose={() => setConfirmOverwrite(false)}
        title="覆蓋已編輯的內容？"
        danger
        confirmLabel="重新產生並覆蓋"
        onConfirm={() => void generate(true)}
        message="這份內容已手動編輯過，重新產生會覆蓋你的修改。建議先複製或下載目前內容。"
      />
    </div>
  );
}
