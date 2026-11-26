/**
 * 待補摘要：最近 30 天還沒有摘要（或之後有新進度）的任務。
 * 可逐一或「全部補寫」（依序執行，可取消），不需要記錄的對話可標為「不需要摘要」。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, EyeOff, Sparkles, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, patch, post, type Job, type Task } from '../lib/api';
import { useJobs, useToast } from '../lib/app';
import { addDays, formatDateLong, todayStr } from '../lib/format';
import { TaskCard } from '../components/TaskCard';
import { useOpenTask } from '../lib/useOpenTask';
import { TaskPanel } from '../components/TaskPanel';
import { Button, EmptyState, PageHeader, Skeleton } from '../components/ui';

export const PENDING_DAYS = 30;

export function PendingPage() {
  const today = todayStr();
  const qc = useQueryClient();
  const toast = useToast();
  const { track, cancel } = useJobs();
  const [openId, setOpenId] = useOpenTask();
  const [batch, setBatch] = useState<{ done: number; total: number; jobId?: string } | null>(null);
  const stop = useRef(false);
  const [skipping, setSkipping] = useState(false);

  const q = useQuery({
    queryKey: ['tasks', 'pending-page', today],
    queryFn: async () => {
      const r = await get<{ tasks: Task[] }>(`/api/tasks?from=${addDays(today, -PENDING_DAYS)}&to=${today}`);
      return r.tasks.filter((t) => t.summary_status !== 'done' && !t.manual);
    },
  });
  const tasks = q.data ?? [];

  // 側欄數量來自 /api/health，與本頁是同一個定義（30 天、非手動、未完成摘要）。
  // 本頁一拿到新清單就同步過去，避免 health 重新抓取失敗或晚到時側欄停在舊數字。
  useEffect(() => {
    if (!q.data) return;
    qc.setQueryData(['health'], (old: Record<string, unknown> | undefined) => (old ? { ...old, pending_summaries: q.data.length } : old));
  }, [q.data, qc]);

  const groups = useMemo(() => {
    const g = new Map<string, Task[]>();
    for (const t of tasks) (g.get(t.date) ?? g.set(t.date, []).get(t.date)!).push(t);
    return [...g].sort(([a], [b]) => b.localeCompare(a));
  }, [tasks]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['health'] });
  };

  /** 依序補寫，一次一個（避免同時啟動多個 claude -p） */
  const summarizeAll = async () => {
    const list = [...tasks];
    stop.current = false;
    let ok = 0;
    for (const [i, t] of list.entries()) {
      if (stop.current) break;
      try {
        const r = await post<{ job_id: string }>(`/api/tasks/${encodeURIComponent(t.id)}/summarize`);
        setBatch({ done: i, total: list.length, jobId: r.job_id });
        const job = await new Promise<Job>((resolve) => track(r.job_id, resolve));
        if (job.status === 'done') ok++;
      } catch (e) {
        toast.show({ tone: 'error', message: `${t.title || t.id}：${(e as Error).message}` });
      }
      refresh();
    }
    setBatch(null);
    toast.show({ tone: 'success', message: stop.current ? `已停止，完成 ${ok} 個` : `已補寫 ${ok} 個任務的摘要` });
  };

  const skip = async (t: Task) => {
    try {
      const r = await patch<{ task: Task }>(`/api/tasks/${encodeURIComponent(t.id)}`, { base_version: t.version, summary_status: 'done' });
      refresh();
      toast.show({
        message: '已標為不需要摘要',
        duration: 8000,
        action: {
          label: '復原',
          run: async () => {
            await patch(`/api/tasks/${encodeURIComponent(r.task.id)}`, { base_version: r.task.version, summary_status: t.summary_status });
            refresh();
          },
        },
      });
    } catch (e) {
      toast.show({ tone: 'error', message: (e as Error).message });
    }
  };

  /** 全部標為不需要摘要；8 秒內可一次復原 */
  const skipAll = async () => {
    const list = [...tasks];
    setSkipping(true);
    const done: { id: string; version: string; prev: Task['summary_status'] }[] = [];
    for (const t of list) {
      try {
        const r = await patch<{ task: Task }>(`/api/tasks/${encodeURIComponent(t.id)}`, { base_version: t.version, summary_status: 'done' });
        done.push({ id: r.task.id, version: r.task.version, prev: t.summary_status });
      } catch {
        // 單筆失敗（例如剛好被其他來源更新）不影響其他任務
      }
    }
    setSkipping(false);
    refresh();
    toast.show({
      message: `已將 ${done.length} 個任務標為不需要摘要${done.length < list.length ? `（${list.length - done.length} 個失敗）` : ''}`,
      duration: 8000,
      action: {
        label: '全部復原',
        run: async () => {
          for (const d of done) {
            await patch(`/api/tasks/${encodeURIComponent(d.id)}`, { base_version: d.version, summary_status: d.prev }).catch(() => undefined);
          }
          refresh();
        },
      },
    });
  };

  return (
    <>
      <PageHeader
        title="待補摘要"
        subtitle={q.isLoading ? <Skeleton className="h-4 w-48" /> : `最近 ${PENDING_DAYS} 天有 ${tasks.length} 個任務尚未撰寫摘要，或之後有新進度需要更新`}
        actions={
          tasks.length > 0 &&
          (batch ? (
            <Button
              icon={<Square className="size-3.5" />}
              onClick={() => {
                stop.current = true;
                if (batch.jobId) void cancel(batch.jobId);
              }}
            >
              補寫中 {batch.done + 1}/{batch.total}・停止
            </Button>
          ) : (
            <>
              <Button icon={<EyeOff className="size-4" />} loading={skipping} onClick={() => void skipAll()}>
                全部不需要摘要
              </Button>
              <Button variant="primary" icon={<Sparkles className="size-4" />} disabled={skipping} onClick={() => void summarizeAll()}>
                全部補寫（{tasks.length}）
              </Button>
            </>
          ))
        }
      />
      {tasks.length > 0 && (
        <p className="-mt-3 mb-6 text-sm text-ink-3">
          補寫時 Claude 會依當天的對話紀錄撰寫子項與粗估時數，每個約 30～60 秒，使用你的 Claude 訂閱額度。簡短提問或不需要記錄的對話，可以按「不需要摘要」；全部都不想補寫時按「全部不需要摘要」（8 秒內可復原，任務與時數都會保留）。
        </p>
      )}

      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<CheckCheck className="size-8" />} title="沒有待補摘要">
          最近 {PENDING_DAYS} 天的任務都已撰寫摘要。
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {groups.map(([date, ts]) => (
            <section key={date}>
              <h2 className="mb-2 text-sm font-semibold">{formatDateLong(date)}</h2>
              <div className="space-y-3">
                {ts.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onOpen={() => setOpenId(t.id)}
                    actions={
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!batch}
                        onClick={(e) => {
                          e.stopPropagation();
                          void skip(t);
                        }}
                      >
                        不需要摘要
                      </Button>
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {openId && <TaskPanel taskId={openId} onClose={() => setOpenId(null)} onIdChange={setOpenId} />}
    </>
  );
}
