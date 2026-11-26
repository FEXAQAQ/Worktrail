/**
 * 規格 11.4「Prompt」：依類型分組的範本清單；編輯器（{{ 自動完成、未知變數警告）；
 * 試跑（一鍵填入資料並產生預覽，不存檔）；複製為新範本、設為預設、刪除。
 * 內建範本不能直接改：一開始修改就自動另存成「我的版本」並設為預設，不必先複製。
 * 預設範本只在這裡設定（設定頁不再重複）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyPlus, FlaskConical, Lock, Play, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, get, post, put, type PromptInfo, type Task } from '../lib/api';
import { useDebounced, useHotkey, useJobs, useToast } from '../lib/app';
import { addDays, formatDateShort, todayStr } from '../lib/format';
import { Editor, MarkdownView, VARIABLE_DOCS } from '../components/Editor';
import { Banner, Button, Card, cx, ErrorText, Input, Modal, PageTitle, Select, Skeleton, Tag } from '../components/ui';

type PType = PromptInfo['type'];
const TYPE_LABEL: Record<PType, string> = { summary: '每日摘要', weekly: '週報', performance: '績效', talk: '小交流' };
const VARS: Record<PType, string[]> = {
  summary: ['today', 'user_name', 'transcript', 'draft', 'previous_items'],
  weekly: ['period', 'period_start', 'period_end', 'today', 'user_name', 'records', 'stats', 'previous'],
  performance: ['period', 'period_start', 'period_end', 'today', 'user_name', 'records', 'stats', 'previous'],
  talk: ['dates', 'period', 'period_start', 'period_end', 'today', 'user_name', 'records', 'stats', 'previous'],
};

export function PromptsPage() {
  const { type, name } = useParams();
  const list = useQuery({ queryKey: ['prompts'], queryFn: () => get<{ prompts: PromptInfo[]; defaults: Record<PType, string> }>('/api/prompts') });
  const ref = type && name ? `${type}/${name}` : 'weekly/default';
  const defaults = list.data?.defaults;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside>
        <PageTitle className="mb-4">提示詞範本</PageTitle>
        {list.isLoading ? (
          <Skeleton className="h-80" />
        ) : (
          <div className="space-y-5">
            {(['summary', 'weekly', 'performance', 'talk'] as PType[]).map((t) => (
              <div key={t}>
                <div className="mb-1.5 px-1 text-xs font-semibold text-ink-3">{TYPE_LABEL[t]}</div>
                <Card className="overflow-hidden py-1">
                  {list.data!.prompts
                    .filter((p) => p.type === t)
                    .map((p) => (
                      <Link
                        key={p.ref}
                        to={`/prompts/${p.ref}`}
                        className={cx('flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover', p.ref === ref && 'bg-accent-soft font-semibold text-accent')}
                      >
                        <span className="min-w-0 flex-1 truncate">{p.title}</span>
                        {defaults?.[t] === p.ref && <Star className="size-3.5 fill-current text-warn" aria-label="預設" />}
                        {p.builtin && <Tag className="text-2xs">內建</Tag>}
                      </Link>
                    ))}
                </Card>
              </div>
            ))}
          </div>
        )}
      </aside>
      <section className="min-w-0">{list.data && <PromptEditor key={ref} refName={ref} isDefault={defaults?.[ref.split('/')[0] as PType] === ref} />}</section>
    </div>
  );
}

/** 新範本的檔名：使用者只填顯示名稱，檔名自動產生 */
const newPromptName = () => `my-${Date.now().toString(36)}`;
/** 改寫範本前段的 name（顯示名稱） */
const withTitle = (text: string, title: string) => text.replace(/^(---\r?\n[\s\S]*?)name:.*$/m, `$1name: ${title}`);

async function setDefaultPrompt(type: PType, ref: string) {
  const { config } = await get('/api/config');
  const next = structuredClone(config);
  if (type === 'summary') next.summary.default_prompt = ref;
  else next.report[type].default_prompt = ref;
  await put('/api/config', { config: next });
}

function PromptEditor({ refName, isDefault }: { refName: string; isDefault: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [type] = refName.split('/') as [PType, string];
  const q = useQuery({ queryKey: ['prompt', refName], queryFn: () => get<{ prompt: PromptInfo & { text: string }; validation: { errors: string[]; warnings: string[] } }>(`/api/prompts/${refName}`) });
  const [text, setText] = useState('');
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const [saved, setSaved] = useState<'' | 'saving' | 'saved'>('');
  const [copyOpen, setCopyOpen] = useState(false);
  /** 刪除後 8 秒內可復原，因此不另外確認 */
  const removePrompt = async () => {
    try {
      const r = await del<{ text: string }>(`/api/prompts/${refName}`);
      void qc.invalidateQueries({ queryKey: ['prompts'] });
      navigate(`/prompts/${type}/builtin`);
      toast.show({
        message: '已刪除範本',
        duration: 8000,
        action: {
          label: '復原',
          run: async () => {
            await put(`/api/prompts/${refName}`, { text: r.text });
            void qc.invalidateQueries({ queryKey: ['prompts'] });
            navigate(`/prompts/${refName}`);
          },
        },
      });
    } catch (e) {
      toast.show({ tone: 'error', message: (e as Error).message });
    }
  };
  const hash = useRef<string | undefined>(undefined);
  const builtin = q.data?.prompt.builtin ?? false;

  useEffect(() => {
    if (q.data) {
      setText(q.data.prompt.text);
      setValidation(q.data.validation);
      hash.current = q.data.prompt.hash;
    }
  }, [q.data]);

  const validate = useDebounced(async (t: string) => setValidation(await post('/api/prompts/validate', { ref: refName, text: t })), 300);
  /** 修改內建範本：另存成使用者的版本並設為預設，再切換過去 */
  const forking = useRef(false);
  const forkBuiltin = async (t: string) => {
    if (forking.current) return;
    forking.current = true;
    try {
      const ref = `${type}/${newPromptName()}`;
      await put(`/api/prompts/${ref}`, { text: withTitle(t, `${q.data?.prompt.title ?? TYPE_LABEL[type]}（我的版本）`) });
      await setDefaultPrompt(type, ref);
      void qc.invalidateQueries({ queryKey: ['prompts'] });
      toast.show({ tone: 'success', message: '已另存為你的版本，並設為預設範本' });
      navigate(`/prompts/${ref}`);
    } catch (e) {
      forking.current = false;
      toast.show({ tone: 'error', message: (e as Error).message });
    }
  };

  const save = async (t: string) => {
    const v = await post<{ errors: string[]; warnings: string[] }>('/api/prompts/validate', { ref: refName, text: t });
    setValidation(v);
    if (v.errors.length) return;
    if (builtin) return void forkBuiltin(t);
    setSaved('saving');
    try {
      const r = await put<{ prompt: PromptInfo }>(`/api/prompts/${refName}`, { text: t, base_hash: hash.current });
      hash.current = r.prompt.hash;
      setSaved('saved');
      void qc.invalidateQueries({ queryKey: ['prompts'] });
    } catch (e) {
      setSaved('');
      toast.show({ tone: 'error', message: e instanceof ApiError && e.status === 409 ? '此範本已在別處更新，請重新整理' : (e as Error).message });
    }
  };
  const autosave = useDebounced((t: string) => void save(t), 600);
  useHotkey('s', (e) => {
    e.preventDefault();
    autosave.flush(text);
  }, { ctrl: true, allowInInput: true });

  const setDefault = async () => {
    await setDefaultPrompt(type, refName);
    void qc.invalidateQueries({ queryKey: ['prompts'] });
    toast.show({ tone: 'success', message: `已設為${TYPE_LABEL[type]}的預設範本` });
  };

  if (q.isLoading || !q.data) return <Skeleton className="h-[600px]" />;
  const p = q.data.prompt;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="flex items-center gap-2 text-lg font-bold">
            {p.title}
            {builtin && (
              <Tag>
                <Lock className="size-3" />
                內建
              </Tag>
            )}
            {isDefault && <Tag tone="warn">預設</Tag>}
          </div>
          <div className="text-xs text-ink-3">
            <span className="font-mono">{p.ref}</span>
            {p.description && `・${p.description}`}
            {saved === 'saving' && '・儲存中…'}
            {saved === 'saved' && '・已儲存'}
          </div>
        </div>
        <Button icon={<CopyPlus className="size-4" />} onClick={() => setCopyOpen(true)}>
          複製為新範本
        </Button>
        {!isDefault && (
          <Button icon={<Star className="size-4" />} onClick={() => void setDefault()}>
            設為預設
          </Button>
        )}
        {!builtin && (
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void removePrompt()}>
            刪除
          </Button>
        )}
      </div>

      {builtin && <Banner tone="info">這是內建範本。直接修改會自動另存成「我的版本」並設為預設，內建內容保持不變。</Banner>}

      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-1 text-sm">
          {validation.errors.map((e) => (
            <Banner key={e} tone="danger">
              {e}（修正前不會儲存）
            </Banner>
          ))}
          {validation.warnings.map((w) => (
            <Banner key={w} tone="warn">
              {w}
            </Banner>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_240px]">
        <Card className="min-h-[460px] overflow-hidden">
          <Editor
            value={text}
            variables={VARS[type]}
            onChange={(v) => {
              setText(v);
              validate.run(v);
              autosave.run(v);
            }}
          />
        </Card>
        <Card className="h-fit p-4">
          <div className="mb-2 text-xs font-semibold text-ink-2">可用變數</div>
          <ul className="space-y-2 text-xs">
            {VARS[type].map((v) => (
              <li key={v}>
                <code className="font-mono text-accent">{`{{${v}}}`}</code>
                <div className="text-ink-3">{VARIABLE_DOCS[v]}</div>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-3 text-xs text-ink-3">輸入 {'{{'} 會出現自動完成。範本只決定寫法，輸出格式由系統固定附加。</div>
        </Card>
      </div>

      <TrialRun type={type} refName={refName} text={text} />

      <CopyDialog
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        type={type}
        sourceText={text}
        onCreated={(newRef) => {
          void qc.invalidateQueries({ queryKey: ['prompts'] });
          navigate(`/prompts/${newRef}`);
        }}
      />
    </div>
  );
}

function CopyDialog({ open, onClose, type, sourceText, onCreated }: { open: boolean; onClose: () => void; type: PType; sourceText: string; onCreated: (ref: string) => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const valid = title.trim().length > 0;
  const create = async () => {
    const name = newPromptName();
    try {
      await put(`/api/prompts/${type}/${name}`, { text: withTitle(sourceText, title.trim()) });
      onCreated(`${type}/${name}`);
      onClose();
      setTitle('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="複製為新範本"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => void create()}>
            建立
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <div className="mb-1 text-xs text-ink-2">名稱</div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如 英文週報"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && valid && void create()}
          />
        </label>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Modal>
  );
}

/** 試跑：一鍵填入資料並產生預覽（不存檔）；也可以只看填入資料後的完整 prompt，不使用 Claude 額度 */
function TrialRun({ type, refName, text }: { type: PType; refName: string; text: string }) {
  const { track, cancel } = useJobs();
  const toast = useToast();
  const today = todayStr();
  const [which, setWhich] = useState<'current' | 'previous' | 'custom'>('current');
  const [range, setRange] = useState({ start: addDays(today, -6), end: today });
  const [taskId, setTaskId] = useState('');
  const [rendered, setRendered] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const { jobs } = useJobs();
  const tasks = useQuery({
    queryKey: ['tasks', 'recent-for-trial'],
    queryFn: () => get<{ tasks: Task[] }>(`/api/tasks?from=${addDays(today, -14)}&to=${today}`),
    enabled: type === 'summary',
  });

  useEffect(() => {
    if (jobId && jobs[jobId]?.progress) setProgress(jobs[jobId]!.progress!);
  }, [jobs, jobId]);

  const periodFor = async () => {
    if (which === 'custom') return range;
    const list = await get<{ reports: { period: { start: string; end: string } }[] }>(`/api/reports?type=${type}`);
    return list.reports[which === 'current' ? 0 : 1]?.period;
  };

  const render = async (): Promise<string | null> => {
    try {
      const body: Record<string, unknown> = { text };
      if (type === 'summary') body.task_id = taskId || undefined;
      else if (type !== 'talk') body.period = await periodFor();
      const r = await post<{ rendered: string }>(`/api/prompts/${refName}/render`, body);
      setRendered(r.rendered);
      setOutput(null);
      return r.rendered;
    } catch (e) {
      toast.show({ tone: 'error', message: (e as Error).message });
      return null;
    }
  };

  const preview = async () => {
    const filled = await render();
    if (!filled) return;
    const r = await post<{ job_id: string }>(`/api/prompts/${refName}/preview`, { rendered: filled });
    setJobId(r.job_id);
    setProgress('Claude 撰寫中…');
    track(r.job_id, (j) => {
      setJobId(null);
      if (j.status === 'done') setOutput(j.result?.output ?? '');
    });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FlaskConical className="size-4 text-accent" />
        <div className="mr-auto text-sm font-semibold">試跑</div>
        {type === 'summary' ? (
          <Select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="試跑用的任務" className="max-w-xs">
            <option value="">最近一個任務</option>
            {(tasks.data?.tasks ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {formatDateShort(t.date)} {t.ticket ?? ''} {t.title.slice(0, 30)}
              </option>
            ))}
          </Select>
        ) : type === 'talk' ? (
          <span className="text-xs text-ink-3">以最近 5 個有紀錄的日子試跑</span>
        ) : (
          <>
            <Select value={which} onChange={(e) => setWhich(e.target.value as typeof which)} aria-label="期間">
              <option value="current">本期</option>
              <option value="previous">上一期</option>
              <option value="custom">自訂</option>
            </Select>
            {which === 'custom' && (
              <>
                <Input type="date" className="w-auto" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} aria-label="起始日" />
                <Input type="date" className="w-auto" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} aria-label="結束日" />
              </>
            )}
          </>
        )}
        <Button variant="ghost" disabled={!!jobId} onClick={() => void render()}>
          只看 prompt
        </Button>
        {jobId ? (
          <Button onClick={() => void cancel(jobId)}>{progress}・取消</Button>
        ) : (
          <Button variant="primary" icon={<Play className="size-3.5" />} onClick={() => void preview()}>
            試跑
          </Button>
        )}
      </div>
      {rendered === null ? (
        <div className="py-6 text-center text-sm text-ink-3">
          按「試跑」以{type === 'talk' ? '最近的紀錄' : `選擇的${type === 'summary' ? '任務' : '期間'}`}填入資料，由 Claude 產生預覽（不存檔，含尚未儲存的修改）。只想確認送出的內容時按「只看 prompt」，不會使用 Claude 額度。
        </div>
      ) : (
        <div className="space-y-4">
          {output !== null && (
            <div className="max-h-[480px] overflow-auto rounded-ctl border border-line px-5 py-4">
              <div className="mb-2 text-xs text-ink-3">預覽輸出（未存檔）</div>
              <MarkdownView text={output} />
            </div>
          )}
          <details open={output === null && !jobId}>
            <summary className="cursor-pointer text-xs text-ink-2 select-none">實際送給 Claude 的完整 prompt</summary>
            <div className="mt-2 max-h-[480px] overflow-auto rounded-ctl border border-line">
              <Editor value={rendered} readOnly minHeight="200px" />
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}
