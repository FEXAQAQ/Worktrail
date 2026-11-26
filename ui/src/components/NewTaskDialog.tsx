/**
 * 手動新增任務：記錄不在 Claude Code 中進行的工作（會議、手動測試、文件、支援等）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { get, post, type Task } from '../lib/api';
import { useToast } from '../lib/app';
import { todayStr } from '../lib/format';
import { Button, cx, ErrorText, Field, Input, Modal, projectColor, INPUT_CLASS } from './ui';

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => get<{ projects: string[] }>('/api/projects'), staleTime: 30_000 });
}

/**
 * 專案輸入框：可從既有專案清單選擇，也可自由輸入新名稱。
 * 不用原生 <datalist>：它會依目前值過濾，欄位已有值時只剩同名一項，外觀也無法配合主題。
 * 打開時列出全部專案；開始打字後才依輸入過濾。清單以 portal 固定定位，避免被捲動容器裁切。
 */
export function ProjectCombobox({
  value,
  onChange,
  onBlur,
  className,
  style,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const projects = useProjects();
  const all = projects.data?.projects ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; bottom: number } | null>(null);

  const q = value.trim().toLowerCase();
  const options = typed && q ? all.filter((p) => p.toLowerCase().includes(q)) : all;

  const show = () => {
    setTyped(false);
    setActive(Math.max(0, all.indexOf(value)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (p: string) => {
    onChange(p);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width, bottom: r.top - 4 });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show();
      if (!options.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + options.length) % options.length);
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape' && open) {
      // 只關清單，不讓外層（對話框、側欄）一併關閉
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const spaceBelow = rect ? window.innerHeight - rect.top : 0;
  const flipUp = rect ? spaceBelow < 200 && rect.bottom > spaceBelow : false;

  return (
    <div className="relative w-full min-w-0">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        className={cx(className, 'pr-8')}
        style={style}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setActive(0);
          setOpen(true);
        }}
        onClick={() => !open && show()}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          onBlur?.();
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? '收合專案清單' : '展開專案清單'}
        className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-ctl text-ink-3 hover:bg-hover hover:text-ink"
        onMouseDown={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          if (open) close();
          else show();
        }}
      >
        <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        rect &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="fixed z-(--z-popover) max-h-60 overflow-auto rounded-ctl border border-line bg-card py-1 text-sm shadow-pop"
            style={{
              left: rect.left,
              width: Math.max(rect.width, 160),
              ...(flipUp ? { bottom: window.innerHeight - rect.bottom } : { top: rect.top }),
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.length === 0 ? (
              <li className="px-3 py-1.5 text-xs text-ink-3">{all.length ? `沒有符合的專案，將建立「${value.trim()}」` : '尚無專案，輸入名稱即可建立'}</li>
            ) : (
              options.map((p, i) => (
                <li
                  key={p}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={p === value}
                  className={cx('flex cursor-pointer items-center gap-2 px-3 py-1.5', i === active && 'bg-hover')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(p)}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: projectColor(p).fg }} />
                  <span className="flex-1 truncate" style={{ color: projectColor(p).fg }}>
                    {p}
                  </span>
                  {p === value && <Check className="size-3.5 shrink-0 text-ink-3" />}
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}

export function NewTaskButton({ date, onCreated }: { date?: string; onCreated: (task: Task) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
        新增任務
      </Button>
      <NewTaskDialog open={open} onClose={() => setOpen(false)} defaultDate={date} onCreated={onCreated} />
    </>
  );
}

export function NewTaskDialog({ open, onClose, defaultDate, onCreated }: { open: boolean; onClose: () => void; defaultDate?: string; onCreated: (task: Task) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ date: defaultDate ?? todayStr(), title: '', project: '', ticket: '', hours: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm({ date: defaultDate ?? todayStr(), title: '', project: '', ticket: '', hours: 1 });
      setError('');
    }
  }, [open, defaultDate]);

  const submit = async () => {
    if (!form.title.trim()) return setError('請填寫標題');
    setBusy(true);
    try {
      const r = await post<{ task: Task }>('/api/tasks', { ...form, ticket: form.ticket || null });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      toast.show({ tone: 'success', message: '已新增任務，接著可以加入子項' });
      onClose();
      onCreated(r.task);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新增任務"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            新增
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-xs text-ink-3">記錄不在 Claude Code 中進行的工作，例如會議、手動測試、撰寫文件、協助同事。週報與績效會一併統計。</p>
        <Field label="標題">
          <Input autoFocus value={form.title} placeholder="例如 與 SE 討論 DKIM 網域設定" onChange={(e) => setForm({ ...form, title: e.target.value })} invalid={!!error && !form.title.trim()} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="日期">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="時數">
            <Input type="number" step={0.5} min={0} max={24} value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} />
          </Field>
          <Field label="專案" hint="可從清單選擇，或輸入新名稱">
            <ProjectCombobox
              ariaLabel="專案"
              className={cx(INPUT_CLASS, 'border-line')}
              value={form.project}
              placeholder="選擇或輸入"
              onChange={(v) => setForm((f) => ({ ...f, project: v }))}
            />
          </Field>
          <Field label="單號（選填）">
            <Input className="font-mono" value={form.ticket} placeholder="TDDA-1869" onChange={(e) => setForm({ ...form, ticket: e.target.value })} />
          </Field>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
