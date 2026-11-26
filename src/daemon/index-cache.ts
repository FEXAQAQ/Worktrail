/**
 * 任務的記憶體索引（規格 4：啟動時掃描檔案建立索引）＋檔案監看（規格 11.5：1 秒內推送變動）。
 */
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { StoragePaths } from '../core/storage/paths.js';
import { readTask, type TaskRecord } from '../core/storage/tasks.js';

export type ChangeKind = 'task' | 'weekly' | 'performance' | 'talk' | 'prompt' | 'config';

export interface ChangeEvent {
  kind: ChangeKind;
  action: 'add' | 'change' | 'unlink';
  path: string;
  id?: string;
}

export class TaskIndex extends EventEmitter {
  private byPath = new Map<string, TaskRecord>();
  private watcher?: FSWatcher;

  constructor(readonly paths: StoragePaths) {
    super();
  }

  load(): void {
    this.byPath.clear();
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (f.endsWith('.md')) {
          const t = readTask(p);
          if (t) this.byPath.set(p, t);
        } else if (!f.startsWith('.') && statSync(p).isDirectory()) walk(p);
      }
    };
    walk(this.paths.tasks);
  }

  all(): TaskRecord[] {
    return [...this.byPath.values()];
  }

  query(f: { from?: string; to?: string; project?: string; ticket?: string; status?: string; q?: string }): TaskRecord[] {
    const q = f.q?.toLowerCase();
    return this.all()
      .filter(
        (t) =>
          (!f.from || t.date >= f.from) &&
          (!f.to || t.date <= f.to) &&
          (!f.project || t.project === f.project) &&
          (!f.ticket || t.ticket === f.ticket) &&
          (!f.status || t.summary_status === f.status) &&
          (!q ||
            [t.ticket, t.title, t.project, t.body, ...t.items.map((i) => i.text)].some((s) => s?.toLowerCase().includes(q))),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || (b.first_activity ?? '').localeCompare(a.first_activity ?? ''));
  }

  byId(id: string): TaskRecord | undefined {
    return this.all().find((t) => t.id === id);
  }

  /** 直接更新（API 寫入後立即反映，不等監看事件） */
  upsert(t: TaskRecord, previousPath?: string): void {
    if (previousPath && previousPath !== t.path) this.byPath.delete(previousPath);
    this.byPath.set(t.path, t);
  }

  remove(path: string): void {
    this.byPath.delete(path);
  }

  classify(path: string): ChangeKind | null {
    const rel = relative(this.paths.root, path);
    if (rel.startsWith('..') || rel.startsWith('.worktrail')) return null;
    const top = rel.split(sep)[0];
    if (top === 'tasks' && path.endsWith('.md')) return 'task';
    if (top === 'weekly' && path.endsWith('.md')) return 'weekly';
    if (top === 'performance' && path.endsWith('.md')) return 'performance';
    if (top === 'talk' && path.endsWith('.md')) return 'talk';
    if (top === 'prompts' && path.endsWith('.md')) return 'prompt';
    if (rel === 'config.yaml') return 'config';
    return null;
  }

  watch(): void {
    this.watcher = watch(this.paths.root, {
      ignoreInitial: true,
      ignored: (p: string) => p.includes(`${sep}.worktrail`) || p.endsWith('.tmp') || p.endsWith('.lock'),
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const on = (action: ChangeEvent['action']) => (path: string) => {
      const kind = this.classify(path);
      if (!kind) return;
      if (kind === 'task') {
        if (action === 'unlink') this.byPath.delete(path);
        else {
          const t = readTask(path);
          if (t) this.byPath.set(path, t);
        }
      }
      this.emit('change', { kind, action, path, id: basename(path, '.md') } satisfies ChangeEvent);
    };
    this.watcher.on('add', on('add')).on('change', on('change')).on('unlink', on('unlink'));
  }

  async close(): Promise<void> {
    await this.watcher?.close();
  }
}
