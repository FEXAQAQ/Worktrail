/**
 * 規格 11.3：Ctrl+K 指令面板。搜尋任務、單號、報告，並快速跳轉頁面或執行動作。
 */
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { BarChart3, CalendarDays, FileText, MessagesSquare, Moon, NotebookPen, RefreshCw, Settings, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, type Task } from '../lib/api';
import { useJobs, useTheme, useToast } from '../lib/app';
import { formatDateShort } from '../lib/format';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const { track } = useJobs();
  const toast = useToast();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => get<{ tasks: Task[]; reports: { type: string; id: string }[] }>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.trim().length > 0,
  });

  if (!open) return null;
  const go = (to: string) => {
    navigate(to);
    onClose();
  };

  const pages = [
    { to: '/', label: '今日', icon: CalendarDays },
    { to: '/talk', label: '小交流', icon: MessagesSquare },
    { to: '/log', label: '日誌', icon: NotebookPen },
    { to: '/pending', label: '待補摘要', icon: Sparkles },
    { to: '/weekly', label: '週報', icon: FileText },
    { to: '/performance', label: '績效', icon: BarChart3 },
    { to: '/prompts', label: '提示詞範本', icon: Sparkles },
    { to: '/settings', label: '設定', icon: Settings },
  ];

  const item = 'flex cursor-pointer items-center gap-3 rounded-ctl px-3 py-2 text-sm text-ink';

  return (
    <div className="fade-in fixed inset-0 z-(--z-modal) flex items-start justify-center bg-overlay p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Command
        label="指令面板"
        shouldFilter={false}
        className="w-full max-w-xl overflow-hidden rounded-card border border-line bg-card shadow-overlay"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <Command.Input
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder="搜尋任務、單號、報告，或輸入頁面名稱…"
          className="h-12 w-full border-b border-line bg-transparent px-4 text-sm outline-none placeholder:text-ink-3"
        />
        <Command.List className="max-h-[50vh] overflow-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">{search.isFetching ? '搜尋中…' : '沒有符合的結果'}</Command.Empty>
          {(search.data?.tasks.length ?? 0) > 0 && (
            <Command.Group heading="任務" className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {search.data!.tasks.map((t) => (
                <Command.Item key={t.id} value={`task-${t.id}`} onSelect={() => go(`/log?task=${encodeURIComponent(t.id)}`)} className={item}>
                  <span className="w-20 shrink-0 text-xs text-ink-3">{formatDateShort(t.date)}</span>
                  {t.ticket && <span className="font-mono text-xs text-accent">{t.ticket}</span>}
                  <span className="truncate">{t.title || '（無標題）'}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {(search.data?.reports.length ?? 0) > 0 && (
            <Command.Group heading="報告" className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {search.data!.reports.map((r) => (
                <Command.Item key={`${r.type}-${r.id}`} value={`report-${r.type}-${r.id}`} onSelect={() => go(`/${r.type}/${r.id}`)} className={item}>
                  <FileText className="size-4 text-ink-3" />
                  {r.type === 'weekly' ? '週報' : '績效'} {r.id}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="頁面" className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {pages
              .filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase()))
              .map(({ to, label, icon: Icon }) => (
                <Command.Item key={to} value={`page-${to}`} onSelect={() => go(to)} className={item}>
                  <Icon className="size-4 text-ink-3" />
                  {label}
                </Command.Item>
              ))}
          </Command.Group>
          <Command.Group heading="動作" className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            <Command.Item
              value="action-sweep"
              className={item}
              onSelect={async () => {
                onClose();
                const r = await post<{ job_id: string }>('/api/sweep');
                toast.show({ message: '開始補漏掃描…' });
                track(r.job_id, (j) => j.status === 'done' && toast.show({ tone: 'success', message: `掃描完成：擷取 ${j.result?.captured ?? 0} 個 session` }));
              }}
            >
              <RefreshCw className="size-4 text-ink-3" /> 立即掃描
            </Command.Item>
            <Command.Item
              value="action-theme"
              className={item}
              onSelect={() => {
                setTheme(theme === 'dark' ? 'light' : 'dark');
                onClose();
              }}
            >
              <Moon className="size-4 text-ink-3" /> 切換深色模式
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
