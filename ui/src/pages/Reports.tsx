/**
 * 規格 11.4「週報／績效」（兩頁結構相同）。
 * 左欄期間清單；右欄工具列（範本、產生、複製、下載）、Markdown 編輯器（編輯／預覽／並排）、統計卡片。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Columns2, Copy, Download, Eye, FileText, Pencil, Sparkles, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, get, post, put, type Period, type PromptInfo, type Report, type ReportListItem, type Stats } from '../lib/api';
import { useDebounced, useJobs, useRunningJob, useToast } from '../lib/app';
import { download, fmtHours, pct } from '../lib/format';
import { ProjectDonut, WeeklyTrend } from '../components/Charts';
import { Editor, MarkdownView } from '../components/Editor';
import { SnapshotButton } from '../components/ShareCard';
import { DOC_STATUS, PromptSelect, ReportTabs, useDocMode } from '../components/DocShared';
import { AppraisalTable } from '../components/AppraisalTable';
import { appraisalTitle, parseAppraisal } from '../lib/appraisal';
import { Banner, Button, Card, Confirm, cx, EmptyState, ErrorText, Field, Input, LinkButton, Modal, PageTitle, Segmented, Select, Skeleton, Tag } from '../components/ui';

type Type = 'weekly' | 'performance';
const TYPE_LABEL: Record<Type, string> = { weekly: '週報', performance: '績效' };

const STATUS = DOC_STATUS;

interface ReportDetail {
  id: string;
  period: Period;
  label: string;
  report: Report | null;
  stats: Stats;
  weekly_trend?: { id: string; hours: number }[];
  missing_weeks?: { id: string; period: Period }[];
  pending_summaries: number;
}

export function ReportsPage({ type }: { type: Type }) {
  const { period: periodParam } = useParams();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['reports', type], queryFn: () => get<{ reports: ReportListItem[] }>(`/api/reports?type=${type}`) });
  const current = periodParam ?? list.data?.reports[0]?.id;

  const reports = list.data?.reports ?? [];
  const isCustom = !!current && !reports.some((r) => r.id === current);
  const go = (id: string) => navigate(`/${type}/${id}`);

  return (
    <div className="grid h-full gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      {/* 寬螢幕：左欄期間清單 */}
      <aside className="hidden min-w-0 xl:block">
        <div className="mb-4 flex items-center justify-between gap-2">
          <PageTitle>報告</PageTitle>
          <CustomPeriodButton type={type} />
        </div>
        <ReportTabs className="mb-3" />
        <Card className="overflow-hidden">
          {list.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-240px)] overflow-auto py-1" role="listbox" aria-label="期間">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/${type}/${r.id}`}
                    className={cx('flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-hover', r.id === current && 'bg-accent-soft')}
                    aria-selected={r.id === current}
                  >
                    <div className="min-w-0">
                      <div className={cx('font-medium', r.id === current && 'text-accent')}>{r.id}</div>
                      <div className="truncate text-xs text-ink-3">{r.label}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={STATUS[r.status].cls}>{STATUS[r.status].label}</div>
                      <div className="text-ink-3">{r.task_count} 任務</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>

      <section className="min-w-0">
        {/* 較窄的視窗：頂部期間選單 */}
        <div className="mb-5 flex flex-wrap items-center gap-2 xl:hidden">
          <PageTitle className="mr-2">報告</PageTitle>
          <ReportTabs className="mr-2 w-full sm:w-auto" />
          <Select aria-label="期間" className="min-w-0 max-w-full flex-1 sm:flex-none" value={current ?? ''} onChange={(e) => go(e.target.value)}>
            {isCustom && <option value={current}>自訂：{current!.replace('_', ' ～ ')}</option>}
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}（{r.label}）・{STATUS[r.status].label}・{r.task_count} 任務
              </option>
            ))}
          </Select>
          <CustomPeriodButton type={type} />
        </div>
        {current ? <ReportDetailView key={`${type}/${current}`} type={type} id={current} /> : list.isLoading ? <Skeleton className="h-96" /> : <EmptyState title="沒有期間" />}
      </section>
    </div>
  );
}

/** 自訂期間：以小視窗選擇起訖日，避免在窄欄中擠壓 */
function CustomPeriodButton({ type, className }: { type: Type; className?: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ start: '', end: '' });
  const valid = !!range.start && !!range.end && range.start <= range.end;
  const submit = () => {
    if (!valid) return;
    setOpen(false);
    navigate(`/${type}/${range.start}_${range.end}`);
  };
  return (
    <>
      <Button className={className} icon={<CalendarRange className="size-4" />} onClick={() => setOpen(true)}>
        自訂期間
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`自訂${TYPE_LABEL[type]}期間`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={!valid} onClick={submit}>
              開啟
            </Button>
          </>
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="起始日">
            <Input type="date" autoFocus value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
          </Field>
          <Field label="結束日">
            <Input type="date" value={range.end} min={range.start || undefined} onChange={(e) => setRange({ ...range, end: e.target.value })} />
          </Field>
          {range.start && range.end && !valid && <ErrorText className="sm:col-span-2">結束日不可早於起始日</ErrorText>}
          <button type="submit" hidden />
        </form>
      </Modal>
    </>
  );
}

function ReportDetailView({ type, id }: { type: Type; id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { track, cancel } = useJobs();
  const detail = useQuery({ queryKey: ['report', type, id], queryFn: () => get<ReportDetail>(`/api/reports/${type}/${id}`) });
  const prompts = useQuery({ queryKey: ['prompts'], queryFn: () => get<{ prompts: PromptInfo[]; defaults: Record<string, string> }>('/api/prompts') });
  const running = useRunningJob('generate', `${type}/${id}`);

  const [prompt, setPrompt] = useState<string>('');
  const [text, setText] = useState('');
  const appraisal = useMemo(() => (type === 'performance' ? parseAppraisal(text) : null), [type, text]);
  const [mode, setMode] = useDocMode();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [writing, setWriting] = useState(false);
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved'>('');
  const version = useRef<string | null>(null);
  const dirty = useRef(false);
  const [conflict, setConflict] = useState<Report | null>(null);

  const report = detail.data?.report ?? null;
  useEffect(() => {
    if (report && (!dirty.current || report.version === version.current)) {
      setText(report.body);
      version.current = report.version;
    } else if (!report && !dirty.current) {
      setText('');
      version.current = null;
    }
  }, [report]);
  useEffect(() => {
    if (!prompt && prompts.data) setPrompt(report?.prompt && report.prompt !== 'manual' ? report.prompt : prompts.data.defaults[type] ?? `${type}/default`);
  }, [prompts.data, report, prompt, type]);

  const save = async (content: string, base?: string | null) => {
    setSaveState('saving');
    try {
      const r = await put<{ report: Report }>(`/api/reports/${type}/${id}`, { content, base_version: base ?? version.current });
      version.current = r.report.version;
      dirty.current = false;
      setSaveState('saved');
      setConflict(null);
      void qc.invalidateQueries({ queryKey: ['reports', type] });
    } catch (e) {
      setSaveState('');
      if (e instanceof ApiError && e.status === 409) setConflict(e.data?.report ?? null);
      else toast.show({ tone: 'error', message: `儲存失敗：${(e as Error).message}` });
    }
  };
  const autosave = useDebounced((c: string) => void save(c), 600);

  const generate = async (overwrite = false) => {
    try {
      const r = await post<{ job_id: string }>(`/api/reports/${type}/${id}/generate`, { prompt, overwrite });
      track(r.job_id, (j) => {
        if (j.status === 'done') {
          dirty.current = false;
          toast.show({ tone: 'success', message: `${TYPE_LABEL[type]} ${id} 已產生` });
          void qc.invalidateQueries({ queryKey: ['report', type, id] });
          void qc.invalidateQueries({ queryKey: ['reports', type] });
        }
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConfirmOverwrite(true);
      else toast.show({ tone: 'error', message: (e as Error).message });
    }
  };

  const generateMissing = async () => {
    const weeks = detail.data?.missing_weeks ?? [];
    toast.show({ message: `依序產生 ${weeks.length} 份週報…`, duration: 4000 });
    for (const w of weeks) {
      const r = await post<{ job_id: string }>(`/api/reports/weekly/${w.id}/generate`, {});
      await new Promise<void>((resolve) => track(r.job_id, () => resolve()));
    }
    void qc.invalidateQueries({ queryKey: ['report', type, id] });
    toast.show({ tone: 'success', message: '缺少的週報已補產生' });
  };

  if (detail.isLoading) return <Skeleton className="h-[600px]" />;
  if (detail.error || !detail.data) return <EmptyState title="無法載入">{(detail.error as Error)?.message}</EmptyState>;
  const d = detail.data;
  const typePrompts = (prompts.data?.prompts ?? []).filter((p) => p.type === type);
  const hasContent = !!report || text.length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <div className="text-lg font-bold">
            {TYPE_LABEL[type]} {d.id}
          </div>
          <div className="text-xs text-ink-3">
            {d.label}
            {report && `・${report.edited ? '已手動編輯' : `由 ${report.prompt} 產生`}`}
            {saveState === 'saving' && '・儲存中…'}
            {saveState === 'saved' && '・已儲存'}
          </div>
        </div>
        <PromptSelect prompts={typePrompts} value={prompt} onChange={setPrompt} />
        {running ? (
          <Button variant="secondary" icon={<Square className="size-3.5" />} onClick={() => void cancel(running.id)}>
            {running.progress ?? '產生中…'}・取消
          </Button>
        ) : (
          <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void generate(false)}>
            {report ? '重新產生' : '產生'}
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
        <SnapshotButton disabled={!text} content={{ kind: TYPE_LABEL[type], title: `${TYPE_LABEL[type]} ${d.id}`, subtitle: d.label, stats: d.stats, text, donut: true }} />
        <Button variant="ghost" icon={<Download className="size-4" />} disabled={!text} onClick={() => download(`${type === 'weekly' ? '週報' : '績效'}-${d.id}.md`, text)}>
          下載 .md
        </Button>
      </div>

      {report?.stale && (
        <Banner tone="warn">
          來源資料在產生後有變動。
          <LinkButton onClick={() => void generate(false)}>
            重新產生
          </LinkButton>
        </Banner>
      )}
      {(d.missing_weeks?.length ?? 0) > 0 && (
        <Banner tone="warn">
          期間內有 {d.missing_weeks!.length} 週缺少週報：{d.missing_weeks!.map((w) => w.id).join('、')}。
          <LinkButton onClick={() => void generateMissing()}>
            補產生缺少的週報
          </LinkButton>
        </Banner>
      )}
      {d.pending_summaries > 0 && (
        <Banner tone="info">
          期間內有 {d.pending_summaries} 個任務待補摘要，產生前建議先到
          <Link to="/pending" className="mx-1 underline">
            待補摘要頁
          </Link>
          補寫。
        </Banner>
      )}
      {conflict && (
        <Banner tone="warn">
          此內容已在別處更新。
          <LinkButton onClick={() => void save(text, conflict.version)}>
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

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard label="總時數" value={fmtHours(d.stats.total_hours)} sub={`${d.stats.days_worked} 天・${d.stats.task_count} 任務・${d.stats.ticket_count} 單號`} />
        <StatCard label="完成率" value={pct(d.stats.completion_rate)} sub={`完成 ${d.stats.items_by_status.done}・未完成 ${d.stats.open_items.length}・卡住 ${d.stats.items_by_status.blocked}`} />
        <Card className="min-w-0 p-3 sm:col-span-2">
          <div className="mb-1 text-xs text-ink-3">專案時數分布</div>
          <ProjectDonut data={d.stats.hours_by_project} />
        </Card>
      </div>
      {type === 'performance' && d.weekly_trend && (
        <Card className="p-4">
          <div className="mb-2 text-xs text-ink-3">各週時數趨勢</div>
          <WeeklyTrend data={d.weekly_trend} />
        </Card>
      )}

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
          {report && <Tag className="ml-auto">{report.generated_at.slice(0, 16).replace('T', ' ')}</Tag>}
        </div>
        {!hasContent && !running && !writing ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={<FileText className="size-8" />}
              title={`尚未產生${TYPE_LABEL[type]}`}
              action={
                <div className="flex gap-2">
                  <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void generate(false)}>
                    以「{typePrompts.find((p) => p.ref === prompt)?.title ?? prompt}」產生
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
              {type === 'weekly' ? '由本期間的每日任務彙整。' : '由本期間的週報彙整，統計數字直接由任務計算。'}也可以在 Code 分頁輸入 /worklog-{type === 'weekly' ? 'weekly' : 'perf'}。
            </EmptyState>
          </div>
        ) : (
          <div className={cx('grid min-h-0 flex-1', mode === 'split' && 'lg:grid-cols-2')}>
            {mode !== 'preview' && (
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
                {running && !text ? (
                  <div className="text-sm text-ink-3">{running.progress ?? '產生中…'}</div>
                ) : appraisal ? (
                  <AppraisalTable title={appraisalTitle(text)} rows={appraisal} />
                ) : (
                  <MarkdownView text={text} />
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      <Confirm
        open={confirmOverwrite}
        onClose={() => setConfirmOverwrite(false)}
        title="覆蓋已編輯的報告？"
        danger
        confirmLabel="重新產生並覆蓋"
        onConfirm={() => void generate(true)}
        message="這份報告已手動編輯過，重新產生會覆蓋你的修改。建議先複製或下載目前內容。"
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </Card>
  );
}
