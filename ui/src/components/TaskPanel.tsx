/**
 * 規格 11.4 日誌頁的任務編輯面板（右側滑出）。
 * 原地編輯、600 ms 自動儲存、拖曳排序、版本衝突提示、刪除後 8 秒內可復原（因此刪除不再另外確認）。
 */
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  FolderOpen,
  GripVertical,
  Hand,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Ticket,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError, del, get, patch, post, type Item, type ItemStatus, type Task } from '../lib/api';
import { onFileChange, useDebounced, useHotkey, useToast } from '../lib/app';
import { STATUS_ORDER, fmtHours, formatDateLong, hhmm, relativeTime } from '../lib/format';
import { ProjectCombobox } from './NewTaskDialog';
import { CopyProgressButton, JiraSummarizeButton, SummarizeButton, SummaryStatusTag } from './TaskCard';
import { Button, cx, IconButton, projectColor, StatusBadge, Tag, TITLE_FIELD } from './ui';

/** 退場動畫長度，與 styles.css 的 .panel-sheet.is-closing 一致 */
const PANEL_EXIT_MS = 200;

type Draft = Pick<Task, 'title' | 'project' | 'ticket' | 'hours' | 'body'> & { items: (Item & { key: string })[] };

let keySeq = 0;
const withKeys = (items: Item[]) => items.map((i) => ({ ...i, key: `k${keySeq++}` }));
const toDraft = (t: Task): Draft => ({ title: t.title, project: t.project, ticket: t.ticket, hours: t.hours, body: t.body, items: withKeys(t.items) });
const stripKeys = (items: Draft['items']): Item[] =>
  items
    .filter((i) => i.text.trim())
    .map(({ key: _k, ...i }) => ({ text: i.text.trim(), status: i.status, ...(i.note?.trim() ? { note: i.note.trim() } : {}) }));

export function TaskPanel({ taskId, onClose, onIdChange }: { taskId: string; onClose: () => void; onIdChange: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['task', taskId], queryFn: () => get<{ task: Task }>(`/api/tasks/${encodeURIComponent(taskId)}`) });
  const task = q.data?.task;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [conflict, setConflict] = useState<Task | null>(null);
  const [external, setExternal] = useState(false);
  const version = useRef<string | null>(null);
  const currentId = useRef(taskId);
  const pendingFields = useRef<Set<keyof Draft>>(new Set());

  // 關閉時先播退場動畫（遮罩淡出、面板滑出），再卸載
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(onClose, reduce ? 0 : PANEL_EXIT_MS);
  }, [onClose]);

  // 載入或切換任務時重設草稿
  useEffect(() => {
    if (task && (task.id !== currentId.current || !draft || (!dirty && task.version !== version.current))) {
      setDraft(toDraft(task));
      version.current = task.version;
      currentId.current = task.id;
      setDirty(false);
      setConflict(null);
      setExternal(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  // 檔案被其他來源修改（hook、MCP、外部編輯器）
  useEffect(
    () =>
      onFileChange((e) => {
        if (e.kind !== 'task' || !e.path) return;
        if (task && e.path === task.path) {
          if (dirty) setExternal(true);
          else void qc.invalidateQueries({ queryKey: ['task', currentId.current] });
        }
      }),
    [dirty, task, qc],
  );

  const save = useCallback(
    async (d: Draft, allFields: (keyof Draft)[], baseOverride?: string) => {
      // 暫不處理／卡住的子項要先填原因，才送出子項清單（其他欄位照常儲存）
      const itemsIncomplete = d.items.some((i) => i.text.trim() && (i.status === 'skipped' || i.status === 'blocked') && !i.note?.trim());
      const fields = itemsIncomplete ? allFields.filter((f) => f !== 'items') : allFields;
      if (!fields.length) return;
      const body: Record<string, unknown> = { base_version: baseOverride ?? version.current };
      for (const f of fields) body[f] = f === 'items' ? stripKeys(d.items) : d[f];
      setSaving('saving');
      try {
        const r = await patch<{ task: Task; warnings: string[] }>(`/api/tasks/${encodeURIComponent(currentId.current)}`, body);
        version.current = r.task.version;
        for (const f of fields) pendingFields.current.delete(f);
        setDirty(pendingFields.current.size > 0);
        setSaving('saved');
        setExternal(false);
        for (const w of r.warnings) toast.show({ tone: 'error', message: w });
        if (r.task.id !== currentId.current) {
          currentId.current = r.task.id;
          onIdChange(r.task.id);
        }
        qc.setQueryData(['task', r.task.id], { task: r.task });
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        void qc.invalidateQueries({ queryKey: ['stats'] });
        if (fields.includes('project')) void qc.invalidateQueries({ queryKey: ['projects'] });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setConflict(e.data?.task ?? null);
          setSaving('idle');
        } else {
          setSaving('error');
          toast.show({ tone: 'error', message: `儲存失敗：${(e as Error).message}` });
        }
      }
    },
    [qc, toast, onIdChange],
  );

  const debounced = useDebounced((d: Draft) => void save(d, [...pendingFields.current]), 600);

  const update = (fields: Partial<Draft>, immediate = false) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...fields };
      for (const k of Object.keys(fields) as (keyof Draft)[]) pendingFields.current.add(k);
      setDirty(true);
      if (immediate) debounced.flush(next);
      else debounced.run(next);
      return next;
    });
  };

  const flushNow = () => draft && dirty && debounced.flush(draft);

  useHotkey('Escape', () => {
    flushNow();
    close();
  }, { allowInInput: true });
  useHotkey('s', (e) => {
    e.preventDefault();
    flushNow();
  }, { ctrl: true, allowInInput: true });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!draft || !e.over || e.active.id === e.over.id) return;
    const from = draft.items.findIndex((i) => i.key === e.active.id);
    const to = draft.items.findIndex((i) => i.key === e.over!.id);
    update({ items: arrayMove(draft.items, from, to) }, true);
  };

  const setItem = (key: string, patchItem: Partial<Item>, immediate = false) => {
    if (!draft) return;
    update({ items: draft.items.map((i) => (i.key === key ? { ...i, ...patchItem } : i)) }, immediate);
  };

  const remove = async () => {
    if (!task) return;
    try {
      const r = await del<{ trash_path: string }>(`/api/tasks/${encodeURIComponent(currentId.current)}`);
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      close();
      toast.show({
        message: '已刪除任務',
        duration: 8000,
        action: {
          label: '復原',
          run: async () => {
            await post('/api/tasks/restore', { trash_path: r.trash_path });
            void qc.invalidateQueries({ queryKey: ['tasks'] });
          },
        },
      });
    } catch (e) {
      toast.show({ tone: 'error', message: (e as Error).message });
    }
  };

  const itemKeys = useMemo(() => draft?.items.map((i) => i.key) ?? [], [draft?.items]);

  return (
    <div
      className={cx('panel-backdrop fixed inset-0 z-(--z-panel) flex justify-end bg-overlay', closing && 'is-closing pointer-events-none')}
      onMouseDown={(e) => e.target === e.currentTarget && (flushNow(), close())}
    >
      <aside className={cx('panel-sheet flex h-full w-full max-w-[560px] flex-col border-l border-line bg-card shadow-overlay', closing && 'is-closing')} aria-label="任務編輯面板">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-6">
          <CalendarDays className="size-4 text-ink-3" aria-hidden />
          <div className="text-sm text-ink-2">{task ? formatDateLong(task.date) : '載入中…'}</div>
          {task?.manual && (
            <Tag title="不在 Claude Code 中進行，沒有對話紀錄與 commit">
              <Hand className="size-3" aria-hidden />
              手動新增
            </Tag>
          )}
          {task?.merged && <Tag title={`與當天「${task.project}」的其他任務合併為一筆；改專案就會移出合併`}>已合併</Tag>}
          {task && <SummaryStatusTag status={task.summary_status} />}
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-3" aria-live="polite">
            {saving === 'saving' ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                儲存中
              </>
            ) : saving === 'saved' && !dirty ? (
              <>
                <Check className="size-3" />
                已儲存
              </>
            ) : dirty ? (
              '未儲存'
            ) : (
              ''
            )}
          </span>
          <IconButton size="md" onClick={() => (flushNow(), close())} aria-label="關閉（Esc）">
            <X className="size-4" />
          </IconButton>
        </div>

        {conflict && (
          <div className="flex items-start gap-3 border-b border-warn-line bg-warn-soft px-5 py-3 text-sm text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              此內容已在別處更新。要保留哪一份？
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => draft && void save(draft, [...pendingFields.current], conflict.version).then(() => setConflict(null))}>
                  保留我的修改
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    pendingFields.current.clear();
                    setDraft(toDraft(conflict));
                    version.current = conflict.version;
                    setDirty(false);
                    setConflict(null);
                  }}
                >
                  使用最新版本
                </Button>
              </div>
            </div>
          </div>
        )}
        {external && !conflict && (
          <div className="flex items-center gap-2 border-b border-line bg-hover px-5 py-2 text-xs text-ink-2">
            <AlertTriangle className="size-3.5" /> 此內容已在別處更新，儲存時會詢問要保留哪一份。
          </div>
        )}

        {!task || !draft ? (
          <div className="space-y-3 p-5">
            <div className="skeleton h-7 w-3/4" />
            <div className="skeleton h-5 w-1/2" />
            <div className="skeleton h-32" />
          </div>
        ) : (
          <div className="flex-1 overflow-auto px-6 pb-8 pt-5">
            <AutoTextarea
              aria-label="標題"
              className={TITLE_FIELD}
              value={draft.title}
              placeholder="任務標題"
              onChange={(v) => update({ title: v })}
              onBlur={flushNow}
            />

            <div className="mt-4 space-y-0.5">
              <PropRow icon={FolderOpen} label="專案" locked={task.locked_fields.includes('project')}>
                <ProjectCombobox
                  ariaLabel="專案"
                  className={cx(PROP_INPUT, 'w-full', draft.project && 'font-semibold')}
                  style={draft.project ? { color: projectColor(draft.project).fg } : undefined}
                  placeholder="未指定"
                  value={draft.project}
                  onChange={(v) => update({ project: v })}
                  onBlur={flushNow}
                />
              </PropRow>
              <PropRow icon={Ticket} label="單號" locked={task.locked_fields.includes('ticket')}>
                <input className={cx(PROP_INPUT, 'w-full font-mono')} value={draft.ticket ?? ''} placeholder="無單號" onChange={(e) => update({ ticket: e.target.value || null })} onBlur={flushNow} />
              </PropRow>
              <PropRow icon={Timer} label="時數">
                <div className="flex items-center gap-1">
                  <input
                    aria-label="時數"
                    className={cx(PROP_INPUT, 'w-20 tabular-nums')}
                    type="number"
                    step={0.5}
                    min={0}
                    max={24}
                    value={draft.hours}
                    onChange={(e) => update({ hours: Number(e.target.value) })}
                    onBlur={flushNow}
                  />
                  <span className="shrink-0 text-sm text-ink-3">小時</span>
                  {!task.manual && (
                    <span className="ml-2 truncate text-xs text-ink-3">
                      系統計算 {task.active_minutes} 分（≈{fmtHours(Math.round((task.active_minutes / 60) * 2) / 2)}）
                      {task.hours_source === 'ai' &&
                        (task.hours_estimate !== undefined && task.hours_estimate !== task.hours
                          ? `・AI 粗估 ${fmtHours(task.hours_estimate)}，依每日工時調整`
                          : '・AI 粗估')}
                      {task.hours_source === 'user' && '・手動調整'}
                    </span>
                  )}
                  {task.hours_source !== 'computed' && (
                    <IconButton
                      size="md"
                      className="ml-auto"
                      title="還原為系統計算值"
                      aria-label="還原為系統計算值"
                      onClick={async () => {
                        const r = await patch<{ task: Task }>(`/api/tasks/${encodeURIComponent(currentId.current)}`, { base_version: version.current, hours: null });
                        version.current = r.task.version;
                        setDraft((d) => d && { ...d, hours: r.task.hours });
                        qc.setQueryData(['task', r.task.id], { task: r.task });
                        void qc.invalidateQueries({ queryKey: ['tasks'] });
                      }}
                    >
                      <RotateCcw className="size-3.5" />
                    </IconButton>
                  )}
                </div>
              </PropRow>
            </div>

            <section className="mt-7">
              <div className="mb-2 flex items-baseline gap-2 border-b border-line pb-2">
                <h3 className="text-sm font-semibold">子項</h3>
                {draft.items.length > 0 && (
                  <span className="text-xs tabular-nums text-ink-3">
                    {draft.items.filter((i) => i.status === 'done').length}/{draft.items.length} 完成
                  </span>
                )}
                <span className="ml-auto text-xs text-ink-3">拖曳排序・點狀態切換</span>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={itemKeys} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-0.5">
                    {draft.items.map((i) => (
                      <SortableItem
                        key={i.key}
                        item={i}
                        onChange={(p, immediate) => setItem(i.key, p, immediate)}
                        onBlur={flushNow}
                        onRemove={() => update({ items: draft.items.filter((x) => x.key !== i.key) }, true)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              <AddItem onAdd={(text) => update({ items: [...draft.items, { text, status: 'todo', key: `k${keySeq++}` }] }, true)} />
            </section>

            <section className="mt-7">
              <h3 className="mb-2 border-b border-line pb-2 text-sm font-semibold">補充說明</h3>
              <AutoTextarea
                aria-label="補充說明"
                minRows={3}
                multiline
                className="-mx-2 w-[calc(100%+1rem)] rounded-ctl px-2 py-1.5 text-sm leading-relaxed text-ink-2 hover:bg-hover focus:bg-hover focus:text-ink"
                value={draft.body}
                placeholder="決策紀錄、遇到的問題…"
                onChange={(v) => update({ body: v })}
                onBlur={flushNow}
              />
            </section>

            {!task.manual && (
            <div className="mt-7 rounded-ctl bg-hover px-4 py-3 text-xs">
            <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-ink-3">分支</dt>
              <dd className="font-mono">{task.branch || '—'}</dd>
              <dt className="text-ink-3">活動時間</dt>
              <dd>
                {hhmm(task.first_activity)} – {hhmm(task.last_activity)}
              </dd>
              {task.related_tickets.length > 0 && (
                <>
                  <dt className="text-ink-3">相關單號</dt>
                  <dd className="font-mono">{task.related_tickets.join('、')}</dd>
                </>
              )}
              <dt className="text-ink-3">摘要</dt>
              <dd>{task.summary_updated_at ? `${relativeTime(task.summary_updated_at)}更新` : '尚未撰寫'}</dd>
              <dt className="text-ink-3">Commit</dt>
              <dd>
                {task.commits.length ? (
                  <ul className="space-y-0.5">
                    {task.commits.map((c) => (
                      <li key={c.sha}>
                        <span className="font-mono text-accent">{c.sha}</span> {c.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
            {/* 排查問題才需要的內部資訊，預設收合 */}
            <details className="mt-2">
              <summary className="cursor-pointer text-ink-3 select-none">詳細資訊</summary>
              <dl className="mt-1.5 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-ink-3">工作目錄</dt>
                <dd className="truncate font-mono" title={task.repo}>{task.repo || '—'}</dd>
                <dt className="text-ink-3">Session</dt>
                <dd className="truncate font-mono">{task.session_id}</dd>
                <dt className="text-ink-3">摘要範本</dt>
                <dd className="font-mono">{task.summary_prompt && task.summary_prompt !== 'none' ? task.summary_prompt : '—'}</dd>
              </dl>
            </details>
            </div>
            )}
          </div>
        )}

        {task && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-page/60 px-6 py-3">
            {task.manual ? <JiraSummarizeButton task={task} size="md" /> : <SummarizeButton task={task} size="md" />}
            <CopyProgressButton task={task} label />
            <Button
              variant="ghost"
              className="ml-auto text-ink-3 hover:bg-danger-soft hover:text-danger"
              icon={<Trash2 className="size-4" />}
              onClick={() => void remove()}
            >
              刪除
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}

/** 屬性列的輸入框：平時無框，滑過與聚焦時才出現底色 */
const PROP_INPUT =
  'h-8 min-w-0 rounded-ctl bg-transparent px-2 text-sm text-ink outline-none placeholder:text-ink-3 hover:bg-hover focus:bg-hover [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

function PropRow({ icon: Icon, label, locked, children }: { icon: LucideIcon; label: string; locked?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2">
      <div className="flex items-center gap-1.5 text-sm text-ink-3">
        <Icon className="size-4" aria-hidden />
        {label}
        {locked && (
          <span title="已手動修改，擷取程式不再自動覆寫">
            <Lock className="size-3" />
          </span>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** 依內容自動長高的文字框；非 multiline 時 Enter 直接結束編輯 */
function AutoTextarea({
  value,
  onChange,
  onBlur,
  className,
  placeholder,
  minRows = 1,
  multiline,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
  multiline?: boolean;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      aria-label={ariaLabel}
      className={cx('block resize-none overflow-hidden bg-transparent outline-none placeholder:text-ink-3', className)}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={onBlur}
    />
  );
}

function SortableItem({
  item,
  onChange,
  onBlur,
  onRemove,
}: {
  item: Item & { key: string };
  onChange: (p: Partial<Item>, immediate?: boolean) => void;
  onBlur: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  const needsNote = item.status === 'skipped' || item.status === 'blocked';
  const cycle = () => {
    const next: ItemStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(item.status) + 1) % STATUS_ORDER.length]!;
    onChange({ status: next }, true);
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx('group relative rounded-ctl py-1.5 pl-1 pr-8 hover:bg-hover', isDragging && 'z-(--z-raised) bg-card shadow-pop')}
    >
      <div className="flex items-start gap-1.5">
        <IconButton size="xs" className="mt-0.5 cursor-grab touch-none opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="拖曳排序" {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </IconButton>
        <StatusBadge status={item.status} onClick={cycle} className="mt-0.5 min-w-[4.5rem] justify-center" />
        <div className="min-w-0 flex-1">
          <AutoTextarea
            aria-label="子項內容"
            className={cx('w-full rounded-ctl px-1 text-sm leading-6', item.status === 'done' ? 'text-ink' : item.status === 'skipped' ? 'text-ink-3' : 'text-ink')}
            value={item.text}
            onChange={(v) => onChange({ text: v })}
            onBlur={onBlur}
          />
          {(needsNote || item.note) && (
            <input
              aria-label="備註"
              className={cx(
                'mt-0.5 w-full rounded-ctl bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-ink-3 focus:bg-card',
                needsNote && !item.note?.trim() ? 'text-warn ring-1 ring-warn' : 'text-ink-3',
              )}
              placeholder={needsNote ? '請寫明原因（必填）' : '備註'}
              value={item.note ?? ''}
              onChange={(e) => onChange({ note: e.target.value })}
              onBlur={onBlur}
            />
          )}
        </div>
      </div>
      <IconButton
        tone="danger"
        className="absolute right-1.5 top-2 opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={onRemove}
        aria-label="刪除子項"
      >
        <X className="size-3.5" />
      </IconButton>
    </li>
  );
}

function AddItem({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="mt-1 flex items-center gap-1.5 rounded-ctl pl-1.5 pr-1 text-ink-3 focus-within:bg-hover hover:bg-hover"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) {
          onAdd(text.trim());
          setText('');
        }
      }}
    >
      <Plus className="size-4 shrink-0" />
      <input className="flex-1 bg-transparent px-1 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3" placeholder="新增子項，按 Enter" value={text} onChange={(e) => setText(e.target.value)} />
      {text && <Tag>Enter</Tag>}
    </form>
  );
}
