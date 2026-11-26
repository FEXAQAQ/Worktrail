/**
 * 規格 11.4「今日」：日期、總時數、任務數；任務卡片。只顯示今天；有待補摘要時在頂端提示並連到「待補摘要」頁。
 * 「立即掃描」移到設定 → 整合與指令面板（見 DECISIONS.md），平常由 hook 與每日補漏自動擷取。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, type Task } from '../lib/api';
import { useJobs, useRunningJob, useToast } from '../lib/app';
import { fmtHours, formatDateLong, todayStr } from '../lib/format';
import { flattenEntries, groupEntries, MergeSuggestions, TaskEntries } from '../components/MergedGroup';
import { TaskPanel } from '../components/TaskPanel';
import { NewTaskButton } from '../components/NewTaskDialog';
import { Banner, Button, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { useListNavigation } from './Log';
import { useOpenTask } from '../lib/useOpenTask';

export function SweepButton() {
  const { track } = useJobs();
  const toast = useToast();
  const running = useRunningJob('sweep', 'sweep');
  return (
    <Button
      icon={<RefreshCw className="size-4" />}
      loading={!!running}
      onClick={async () => {
        const r = await post<{ job_id: string }>('/api/sweep');
        track(r.job_id, (j) => {
          if (j.status === 'done') toast.show({ tone: 'success', message: `掃描完成：檢查 ${j.result?.scanned ?? 0} 個紀錄檔，更新 ${j.result?.captured ?? 0} 個` });
        });
      }}
    >
      {running ? running.progress ?? '掃描中…' : '立即掃描'}
    </Button>
  );
}

export function TodayPage() {
  const today = todayStr();
  const [openId, setOpenId] = useOpenTask();

  const tasks = useQuery({ queryKey: ['tasks', 'today', today], queryFn: () => get<{ tasks: Task[] }>(`/api/tasks?from=${today}&to=${today}`) });
  const health = useQuery({ queryKey: ['health'], queryFn: () => get<{ pending_summaries?: number }>('/api/health'), refetchInterval: 60_000 });
  const pending = health.data?.pending_summaries ?? 0;

  const list = tasks.data?.tasks ?? [];
  const sorted = useMemo(() => [...list].sort((a, b) => (a.first_activity ?? '').localeCompare(b.first_activity ?? '')), [list]);
  const entries = useMemo(() => groupEntries(sorted), [sorted]);
  const total = list.reduce((a, t) => a + t.hours, 0);
  const { selected } = useListNavigation(flattenEntries(entries), setOpenId, !openId);

  return (
    <>
      <PageHeader
        title={formatDateLong(today)}
        subtitle={
          tasks.isLoading ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <>
              今日 <b className="text-ink">{fmtHours(total)}</b>・{list.length} 個任務
            </>
          )
        }
        actions={<NewTaskButton date={today} onCreated={(t) => setOpenId(t.id)} />}
      />

      {pending > 0 && (
        <Banner tone="warn" className="mb-4">
          最近有 {pending} 個任務還沒有摘要。
          <Link to="/pending" className="ml-1 font-semibold underline">
            前往補寫
          </Link>
        </Banner>
      )}
      <TicketKeySuggestion />

      {tasks.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-8" />}
          title="今天還沒有工作紀錄"
          action={<NewTaskButton date={today} onCreated={(t) => setOpenId(t.id)} />}
        >
          在 Claude Code 中開始一個對話，回應結束後就會自動記錄；不在 Claude 上的工作可以按「新增任務」手動記錄。如果一直沒有出現，請到
          <Link to="/settings#integration" className="mx-1 text-accent underline">
            設定 → 整合
          </Link>
          檢查 hook 是否已安裝。
        </EmptyState>
      ) : (
        <>
          <MergeSuggestions tasks={sorted} className="mb-3" />
          <TaskEntries entries={entries} onOpen={setOpenId} selected={selected} />
        </>
      )}

      {openId && <TaskPanel taskId={openId} onClose={() => setOpenId(null)} onIdChange={setOpenId} />}
    </>
  );
}

interface KeySuggestion {
  key: string;
  tasks: number;
  example: { ticket: string; source: 'branch' | 'commit' | 'title'; text: string };
}

const SOURCE_LABEL = { branch: '分支', commit: 'commit', title: '標題' } as const;

/** 分支、commit 或標題出現還沒加入的 Jira 專案代碼時，詢問要不要辨識成單號 */
function TicketKeySuggestion() {
  const qc = useQueryClient();
  const toast = useToast();
  const { track } = useJobs();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['ticket-key-suggestions'], queryFn: () => get<{ suggestions: KeySuggestion[] }>('/api/ticket-keys/suggestions'), staleTime: 60_000 });
  const s = q.data?.suggestions[0];
  if (!s) return null;
  const act = async (action: 'add' | 'ignore') => {
    setBusy(true);
    try {
      const r = await post<{ job_id?: string }>('/api/ticket-keys', { key: s.key, action });
      void qc.invalidateQueries({ queryKey: ['ticket-key-suggestions'] });
      void qc.invalidateQueries({ queryKey: ['config'] });
      if (action === 'add') {
        toast.show({ tone: 'success', message: `已加入 ${s.key}，正在更新近期任務的單號` });
        if (r.job_id) track(r.job_id, () => void qc.invalidateQueries({ queryKey: ['tasks'] }));
      } else {
        toast.show({ message: `之後不會再把 ${s.key} 當成單號詢問` });
      }
    } catch (e) {
      toast.show({ tone: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Banner tone="info" className="mb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">
          偵測到新的 Jira 專案代碼 <b>{s.key}</b>（{s.tasks} 個任務，例如{SOURCE_LABEL[s.example.source]}「{s.example.ticket}」）。要把它辨識成單號嗎？
        </span>
        <span className="flex gap-2">
          <Button size="sm" variant="primary" loading={busy} onClick={() => void act('add')}>
            加入
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('ignore')}>
            不是單號
          </Button>
        </span>
      </div>
    </Banner>
  );
}
