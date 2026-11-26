/**
 * 規格 12.4：長時間工作（補寫摘要、產生報告、掃描）。立即回傳 job_id，進度與結果以 SSE 推送。
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface Job {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  progress?: string;
  result?: unknown;
  error?: string;
  started_at: string;
  finished_at?: string;
}

export interface JobContext {
  signal: AbortSignal;
  progress: (message: string) => void;
}

export class JobManager extends EventEmitter {
  private jobs = new Map<string, { job: Job; ctrl: AbortController }>();

  start(kind: string, label: string, fn: (ctx: JobContext) => Promise<unknown>): Job {
    const ctrl = new AbortController();
    const job: Job = { id: randomUUID(), kind, label, status: 'running', started_at: new Date().toISOString() };
    this.jobs.set(job.id, { job, ctrl });
    this.emit('job', { ...job });
    const progress = (message: string) => {
      job.progress = message;
      this.emit('job', { ...job });
    };
    void fn({ signal: ctrl.signal, progress })
      .then((result) => {
        if (job.status !== 'running') return;
        job.status = 'done';
        job.result = result;
      })
      .catch((e: unknown) => {
        if (job.status !== 'running') return;
        job.status = ctrl.signal.aborted ? 'cancelled' : 'error';
        job.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        job.finished_at = new Date().toISOString();
        this.emit('job', { ...job });
        this.prune();
      });
    return { ...job };
  }

  cancel(id: string): boolean {
    const j = this.jobs.get(id);
    if (!j || j.job.status !== 'running') return false;
    j.job.status = 'cancelled';
    j.job.finished_at = new Date().toISOString();
    j.ctrl.abort();
    this.emit('job', { ...j.job });
    return true;
  }

  get(id: string): Job | undefined {
    const j = this.jobs.get(id)?.job;
    return j ? { ...j } : undefined;
  }

  list(): Job[] {
    return [...this.jobs.values()].map((j) => ({ ...j.job })).reverse();
  }

  /** 同類型、同目標的工作正在執行（避免重複按） */
  findRunning(kind: string, label: string): Job | undefined {
    return this.list().find((j) => j.kind === kind && j.label === label && j.status === 'running');
  }

  private prune() {
    const done = [...this.jobs.values()].filter((j) => j.job.status !== 'running');
    for (const j of done.slice(0, Math.max(0, done.length - 50))) this.jobs.delete(j.job.id);
  }
}
