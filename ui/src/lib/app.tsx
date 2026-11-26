/**
 * 全域狀態：提示訊息、工作進度（SSE）、主題、即時同步（規格 11.5）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { del, eventSource, get, put, type Job } from './api';

// ───────────── 提示訊息

export interface Toast {
  id: number;
  message: string;
  tone?: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  /** 毫秒；0 = 不自動關閉 */
  duration?: number;
}

interface ToastCtx {
  toasts: Toast[];
  show: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

export function useToast() {
  const c = useContext(ToastContext);
  if (!c) throw new Error('ToastContext');
  return c;
}

// ───────────── 工作（補寫摘要、產生報告、掃描）

interface JobsCtx {
  jobs: Record<string, Job>;
  /** 註冊工作完成時的回呼 */
  track: (jobId: string, cb?: (j: Job) => void) => void;
  cancel: (jobId: string) => Promise<void>;
}

const JobsContext = createContext<JobsCtx | null>(null);

export function useJobs() {
  const c = useContext(JobsContext);
  if (!c) throw new Error('JobsContext');
  return c;
}

/** 找出指定類型與目標正在執行的工作 */
export function useRunningJob(kind: string, label: string): Job | undefined {
  const { jobs } = useJobs();
  return Object.values(jobs).find((j) => j.kind === kind && j.label === label && j.status === 'running');
}

// ───────────── 主題

export type Theme = 'light' | 'dark';

/** 套用淺色／深色（設定頁切換時先套用，不必等設定儲存完成） */
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
  // 下次開啟時，啟動畫面直接使用相同的主題
  try {
    localStorage.setItem('wt.theme.dark', dark ? '1' : '0');
  } catch {
    // 忽略
  }
}

export type UiStyle = 'default' | 'notebook';

/** 介面風格（筆記本等）與淺／深色獨立，以 html 上的類別切換 */
export function applyStyle(style: UiStyle) {
  document.documentElement.classList.toggle('notebook', style === 'notebook');
  try {
    localStorage.setItem('wt.style', style);
  } catch {
    // 忽略
  }
}

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}
const ThemeContext = createContext<ThemeCtx | null>(null);
export function useTheme() {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('ThemeContext');
  return c;
}

// ───────────── 即時同步：檔案變動時，正在編輯的欄位會被通知

type ChangeListener = (e: { kind: string; id?: string; path: string }) => void;
const changeListeners = new Set<ChangeListener>();
export function onFileChange(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export function AppProviders({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  // 提示訊息
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-4), { ...t, id }]);
      const d = t.duration ?? (t.tone === 'error' ? 6000 : 3000);
      if (d > 0) setTimeout(() => dismiss(id), d);
      return id;
    },
    [dismiss],
  );

  // 工作
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const callbacks = useRef(new Map<string, (j: Job) => void>());
  const track = useCallback((id: string, cb?: (j: Job) => void) => {
    if (cb) callbacks.current.set(id, cb);
    setJobs((js) => (js[id] ? js : { ...js, [id]: { id, kind: '', label: '', status: 'running' } }));
  }, []);
  const cancel = useCallback(async (id: string) => {
    await del(`/api/jobs/${id}`);
  }, []);

  // SSE
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = eventSource();
      es.addEventListener('change', (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as { kind: string; id?: string; path: string };
        for (const l of changeListeners) l(e);
        if (e.kind === 'task') {
          void qc.invalidateQueries({ queryKey: ['tasks'] });
          void qc.invalidateQueries({ queryKey: ['stats'] });
          void qc.invalidateQueries({ queryKey: ['health'] });
          void qc.invalidateQueries({ queryKey: ['reports'] });
          void qc.invalidateQueries({ queryKey: ['report'] });
          void qc.invalidateQueries({ queryKey: ['talks'] });
          void qc.invalidateQueries({ queryKey: ['talk'] });
        } else if (e.kind === 'talk') {
          void qc.invalidateQueries({ queryKey: ['talks'] });
          void qc.invalidateQueries({ queryKey: ['talk'] });
        } else if (e.kind === 'weekly' || e.kind === 'performance') {
          void qc.invalidateQueries({ queryKey: ['reports'] });
          void qc.invalidateQueries({ queryKey: ['report'] });
        } else if (e.kind === 'prompt') {
          void qc.invalidateQueries({ queryKey: ['prompts'] });
          void qc.invalidateQueries({ queryKey: ['prompt'] });
        } else if (e.kind === 'config') {
          void qc.invalidateQueries({ queryKey: ['config'] });
        }
      });
      es.addEventListener('job', (ev) => {
        const j = JSON.parse((ev as MessageEvent).data) as Job;
        setJobs((js) => ({ ...js, [j.id]: j }));
        if (j.status !== 'running') {
          const cb = callbacks.current.get(j.id);
          callbacks.current.delete(j.id);
          cb?.(j);
          if (j.status === 'error') show({ tone: 'error', message: j.error ?? '工作失敗' });
          void qc.invalidateQueries();
        }
      });
      es.onerror = () => {
        es?.close();
        // 重新連線前先確認 token 仍有效（服務重啟後會換新，api() 收到 401 會重新載入頁面）
        retry = setTimeout(() => {
          void get('/api/ping')
            .then(connect)
            .catch(() => (retry = setTimeout(connect, 3000)));
        }, 2000);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, [qc, show]);

  // 主題（存在設定檔）
  const config = useQuery({ queryKey: ['config'], queryFn: () => get('/api/config') });
  const theme: Theme = config.data?.config?.ui?.theme === 'dark' ? 'dark' : 'light';
  const uiStyle: UiStyle | undefined = config.data?.config?.ui?.style;
  useEffect(() => {
    if (uiStyle) applyStyle(uiStyle);
  }, [uiStyle]);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const setTheme = useCallback(
    (t: Theme) => {
      applyTheme(t);
      const cfg = config.data?.config;
      if (cfg) void put('/api/config', { config: { ...cfg, ui: { ...cfg.ui, theme: t } } }).then(() => qc.invalidateQueries({ queryKey: ['config'] }));
    },
    [config.data, qc],
  );

  const toastValue = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);
  const jobsValue = useMemo(() => ({ jobs, track, cancel }), [jobs, track, cancel]);
  const themeValue = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <ToastContext.Provider value={toastValue}>
        <JobsContext.Provider value={jobsValue}>{children}</JobsContext.Provider>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}

/** 防抖：停止輸入 ms 毫秒後執行（規格 11.5：600 ms 自動儲存） */
export function useDebounced<T extends unknown[]>(fn: (...a: T) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(fn);
  latest.current = fn;
  const run = useCallback(
    (...a: T) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => latest.current(...a), ms);
    },
    [ms],
  );
  const flush = useCallback((...a: T) => {
    clearTimeout(timer.current);
    latest.current(...a);
  }, []);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { run, flush, cancel };
}

export function useHotkey(key: string, fn: (e: KeyboardEvent) => void, opts: { ctrl?: boolean; allowInInput?: boolean } = {}) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!!opts.ctrl !== (e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.cm-editor');
      if (typing && !opts.allowInInput) return;
      latest.current(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [key, opts.ctrl, opts.allowInInput]);
}
