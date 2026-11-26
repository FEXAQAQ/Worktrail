/**
 * 首次引導（見 DECISIONS「首次引導」）：你是誰 → Jira 代碼 → 報告週期 → 外觀與完成。
 * 每一步按「下一步」就存檔，中途關掉也不會遺失；「稍後再設定」直接結束引導，之後可在設定頁重新執行。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Loader2, Moon, NotebookPen, Plus, Sparkles, Sun, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put } from '../lib/api';
import { applyStyle, applyTheme, useToast, type Theme, type UiStyle } from '../lib/app';
import { Button, Card, cx, Field, Input, Select, Skeleton } from '../components/ui';

type Cfg = any;

const STEPS = ['你是誰', 'Jira 代碼', '報告週期', '外觀與完成'] as const;

interface KeyChoice {
  key: string;
  current: boolean;
  tasks: number;
  example?: { ticket: string; source: 'branch' | 'commit' | 'title'; text: string };
}

interface PeriodInfo {
  start: string;
  end: string;
  id: string;
}

const SOURCE_LABEL = { branch: '分支', commit: 'commit', title: '標題' } as const;

export function WelcomePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ['config'], queryFn: () => get<{ config: Cfg }>('/api/config') });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Cfg | null>(null);
  const [keys, setKeys] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data && !draft) setDraft(structuredClone(q.data.config));
  }, [q.data, draft]);

  const keyQ = useQuery({
    queryKey: ['onboarding-keys'],
    queryFn: () => get<{ choices: KeyChoice[]; selected: string[]; scanning: boolean }>('/api/onboarding/ticket-keys'),
  });
  // 使用者還沒動過勾選時，跟著掃描結果更新預設勾選
  const [keysTouched, setKeysTouched] = useState(false);
  useEffect(() => {
    if (keyQ.data && !keysTouched) setKeys(keyQ.data.selected);
    // 偵測失敗時退回目前的設定，引導仍可繼續
    else if (keyQ.isError && q.data) setKeys((k) => k ?? q.data.config.ticket.keys);
  }, [keyQ.data, keyQ.isError, keysTouched, q.data]);

  if (!draft || !keys) return <Shell><Skeleton className="h-[420px]" /></Shell>;

  const patch = (fn: (c: Cfg) => void) =>
    setDraft((c: Cfg) => {
      const next = structuredClone(c);
      fn(next);
      return next;
    });

  /** 以服務端最新設定為底，只寫入這一步負責的欄位 */
  const saveConfig = async (fn: (c: Cfg) => void) => {
    const latest = structuredClone((await get<{ config: Cfg }>('/api/config')).config);
    fn(latest);
    await put('/api/config', { config: latest });
  };

  const saveStep = async (s: number) => {
    if (s === 0) {
      await saveConfig((c) => {
        c.user_name = draft.user_name.trim();
        c.time.daily_hours = draft.time.daily_hours;
      });
    } else if (s === 1) {
      await post('/api/onboarding/ticket-keys', { keys, offered: (keyQ.data?.choices ?? []).map((c) => c.key) });
    } else if (s === 2) {
      await saveConfig((c) => {
        c.report.weekly.start_day = draft.report.weekly.start_day;
        c.report.weekly.length_weeks = draft.report.weekly.length_weeks;
        c.report.weekly.anchor_date = draft.report.weekly.anchor_date;
        c.report.performance.period = draft.report.performance.period;
        c.report.performance.year_start_month = draft.report.performance.year_start_month;
      });
    } else {
      await saveConfig((c) => {
        c.ui.theme = draft.ui.theme;
        c.ui.style = draft.ui.style;
        c.ui.onboarding = 'done';
      });
    }
  };

  const next = async () => {
    setSaving(true);
    try {
      await saveStep(step);
      if (step < STEPS.length - 1) {
        setStep(step + 1);
      } else {
        await qc.invalidateQueries();
        navigate('/', { replace: true });
        toast.show({ tone: 'success', message: '設定完成。開一個新的 Claude Code 對話，就會開始自動記錄。', duration: 8000 });
      }
    } catch (e) {
      toast.show({ tone: 'error', message: `儲存失敗：${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const skipAll = async () => {
    setSaving(true);
    try {
      // 外觀已經套用在畫面上，一併保留
      await saveConfig((c) => {
        c.ui.theme = draft.ui.theme;
        c.ui.style = draft.ui.style;
        c.ui.onboarding = 'done';
      });
      await qc.invalidateQueries({ queryKey: ['config'] });
      navigate('/', { replace: true });
      toast.show({ message: '之後可以在 設定 → 一般 重新執行引導。', duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const last = step === STEPS.length - 1;

  return (
    <Shell>
      <div className="mb-6 flex items-center gap-2">
        <NotebookPen className="size-5 text-accent" />
        <span className="font-semibold">歡迎使用 Worktrail</span>
        <span className="ml-auto text-xs text-ink-3">約 1 分鐘，都可以之後在設定頁修改</span>
      </div>
      <Stepper step={step} onJump={(i) => i < step && setStep(i)} />
      <Card className="mt-4 p-6">
        {step === 0 && <StepProfile draft={draft} patch={patch} />}
        {step === 1 && (
          <StepJira
            choices={keyQ.data?.choices ?? []}
            scanning={!!keyQ.data?.scanning}
            selected={keys}
            onChange={(k) => {
              setKeysTouched(true);
              setKeys(k);
            }}
          />
        )}
        {step === 2 && <StepReport draft={draft} patch={patch} />}
        {step === 3 && (
          <StepFinish
            draft={draft}
            onTheme={(t) => {
              applyTheme(t);
              patch((c) => (c.ui.theme = t));
            }}
            onStyle={(s) => {
              applyStyle(s);
              patch((c) => (c.ui.style = s));
            }}
          />
        )}
      </Card>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" onClick={skipAll} disabled={saving}>
          稍後再設定
        </Button>
        <div className="ml-auto flex gap-2">
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)} disabled={saving}>
              上一步
            </Button>
          )}
          <Button variant="primary" onClick={next} loading={saving}>
            {last ? '開始使用' : '下一步'}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-page px-4 py-10 text-ink">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </main>
  );
}

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="引導步驟">
      {STEPS.map((label, i) => (
        <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onJump(i)}
            disabled={i >= step}
            aria-current={i === step ? 'step' : undefined}
            className={cx('flex min-w-0 items-center gap-1.5 text-xs', i === step ? 'font-semibold text-ink' : i < step ? 'text-ink-2 hover:text-ink' : 'text-ink-3')}
          >
            <span
              className={cx(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]',
                i < step ? 'bg-accent text-on-accent' : i === step ? 'border border-accent text-accent' : 'border border-line',
              )}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span className="hidden truncate sm:inline">{label}</span>
          </button>
          {i < STEPS.length - 1 && <span className={cx('h-px flex-1', i < step ? 'bg-accent' : 'bg-line')} />}
        </li>
      ))}
    </ol>
  );
}

function StepTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <p className="mt-1 text-sm text-ink-2">{children}</p>}
    </div>
  );
}

function StepProfile({ draft, patch }: { draft: Cfg; patch: (fn: (c: Cfg) => void) => void }) {
  return (
    <>
      <StepTitle title="你是誰">週報與績效中會用這個名字稱呼你。</StepTitle>
      <div className="space-y-4">
        <Field label="名字">
          <Input autoFocus value={draft.user_name} onChange={(e) => patch((c) => (c.user_name = e.target.value))} placeholder="例如 Leo" />
        </Field>
        <Field label="每日工時（小時）" hint="AI 粗估的時數當天加總超過時，依比例縮減；0 為不限制。">
          <div className="w-28">
            <Input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={draft.time.daily_hours}
              onChange={(e) => e.target.value !== '' && patch((c) => (c.time.daily_hours = Number(e.target.value)))}
            />
          </div>
        </Field>
      </div>
    </>
  );
}

function StepJira({ choices, scanning, selected, onChange }: { choices: KeyChoice[]; scanning: boolean; selected: string[]; onChange: (k: string[]) => void }) {
  const [input, setInput] = useState('');
  // 手動加入、但不在偵測清單中的代碼也要列出來
  const extra = selected.filter((k) => !choices.some((c) => c.key === k)).map((key): KeyChoice => ({ key, current: false, tasks: 0 }));
  const all = [...choices, ...extra];
  const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  const add = () => {
    const k = input.trim().toUpperCase().replace(/-+$/, '');
    if (!/^[A-Z][A-Z0-9]+$/.test(k)) return;
    if (!selected.includes(k)) onChange([...selected, k]);
    setInput('');
  };
  const valid = /^[A-Z][A-Z0-9]+$/.test(input.trim().toUpperCase().replace(/-+$/, ''));

  return (
    <>
      <StepTitle title="Jira 專案代碼">
        單號開頭的代碼，例如 <code className="font-mono">BMS-123</code> 的 <code className="font-mono">BMS</code>。只有勾選的代碼會被認成單號，避免把 UTF-8、SHA-256 誤判。
      </StepTitle>
      {scanning && (
        <div className="mb-3 flex items-center gap-2 text-xs text-ink-2">
          <Loader2 className="size-3.5 animate-spin" />
          正在掃描近 7 天的對話紀錄，偵測到的代碼會自動出現…
        </div>
      )}
      {all.length > 0 ? (
        <ul className="divide-y divide-line rounded-ctl border border-line">
          {all.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-hover">
                <input type="checkbox" className="mt-1 size-4 accent-accent" checked={selected.includes(c.key)} onChange={() => toggle(c.key)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-semibold">{c.key}</span>
                    <span className="text-xs text-ink-3">
                      {c.tasks > 0 ? `近期 ${c.tasks} 個任務` : c.current ? '目前的設定，近期沒有出現' : '手動加入'}
                    </span>
                  </div>
                  {c.example && (
                    <div className="truncate text-xs text-ink-3" title={c.example.text}>
                      {SOURCE_LABEL[c.example.source]}：{c.example.text}
                    </div>
                  )}
                </div>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">還沒偵測到任何代碼。</p>
      )}
      <div className="mt-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="手動加入代碼，例如 BMS"
          className="font-mono"
          aria-label="手動加入 Jira 專案代碼"
        />
        <Button onClick={add} disabled={!valid} icon={<Plus className="size-4" />}>
          加入
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-3">不用 Jira 的話，全部取消勾選即可。之後分支或 commit 出現新的代碼時，今日頁也會詢問要不要加入。</p>
    </>
  );
}

function StepReport({ draft, patch }: { draft: Cfg; patch: (fn: (c: Cfg) => void) => void }) {
  const report = draft.report;
  const preview = useQuery({
    queryKey: ['onboarding-periods', report.weekly, report.performance.period, report.performance.year_start_month],
    queryFn: () => post<{ weekly: PeriodInfo; performance: PeriodInfo | null }>('/api/onboarding/periods', { report }),
    placeholderData: (prev) => prev,
  });
  const multi = (report.weekly.length_weeks ?? 1) > 1;
  return (
    <>
      <StepTitle title="報告週期">決定週報與績效怎麼切分期間。</StepTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="每週起始日">
          <Select className="w-full" value={report.weekly.start_day} onChange={(e) => patch((c) => (c.report.weekly.start_day = e.target.value))}>
            <option value="monday">週一</option>
            <option value="sunday">週日</option>
            <option value="saturday">週六</option>
          </Select>
        </Field>
        <Field label="週報週期">
          <Select className="w-full" value={String(report.weekly.length_weeks ?? 1)} onChange={(e) => patch((c) => (c.report.weekly.length_weeks = Number(e.target.value)))}>
            <option value="1">每週</option>
            <option value="2">每 2 週（雙週報）</option>
            <option value="3">每 3 週</option>
            <option value="4">每 4 週</option>
          </Select>
        </Field>
        {multi && (
          <Field label="週期起算日" hint="任一期第一週內的某一天" className="sm:col-span-2">
            <div className="w-48">
              <Input type="date" value={report.weekly.anchor_date} onChange={(e) => patch((c) => (c.report.weekly.anchor_date = e.target.value))} />
            </div>
          </Field>
        )}
        <Field label="績效週期">
          <Select className="w-full" value={report.performance.period} onChange={(e) => patch((c) => (c.report.performance.period = e.target.value))}>
            <option value="monthly">每月</option>
            <option value="quarterly">每季</option>
            <option value="half_yearly">每半年</option>
            <option value="yearly">每年</option>
            <option value="custom">自訂</option>
          </Select>
        </Field>
        <Field label="考核年度起始月" hint="考核年度不是從 1 月開始時調整">
          <Select
            className="w-full"
            value={String(report.performance.year_start_month)}
            onChange={(e) => patch((c) => (c.report.performance.year_start_month = Number(e.target.value)))}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1} 月
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-5 grid gap-2 rounded-ctl bg-hover px-4 py-3 text-sm sm:grid-cols-2" aria-live="polite">
        <PeriodLine label="本期週報" p={preview.data?.weekly} />
        <PeriodLine label="本期績效" p={preview.data?.performance} empty="自訂：產生時再選日期" />
      </div>
    </>
  );
}

function PeriodLine({ label, p, empty }: { label: string; p: PeriodInfo | null | undefined; empty?: string }) {
  const fmt = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <div>
      <div className="text-xs text-ink-3">{label}</div>
      {p === undefined ? (
        <div className="text-ink-3">…</div>
      ) : p === null ? (
        <div className="text-ink-2">{empty}</div>
      ) : (
        <div>
          <span className="font-semibold">{p.id.includes('_') ? `${fmt(p.start)}–${fmt(p.end)}` : p.id}</span>
          {!p.id.includes('_') && <span className="ml-2 text-ink-2">{`${fmt(p.start)}–${fmt(p.end)}`}</span>}
        </div>
      )}
    </div>
  );
}

interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  fix?: string;
  optional?: boolean;
}

function StepFinish({ draft, onTheme, onStyle }: { draft: Cfg; onTheme: (t: Theme) => void; onStyle: (s: UiStyle) => void }) {
  const health = useQuery({ queryKey: ['health'], queryFn: () => get<{ checks: Check[] }>('/api/health') });
  const checks = health.data?.checks ?? [];
  const failed = checks.filter((c) => !c.ok);
  return (
    <>
      <StepTitle title="外觀">點一下就會套用，看看喜歡哪一種。</StepTitle>
      <div className="space-y-4">
        <Choice
          label="主題"
          value={draft.ui.theme === 'dark' ? 'dark' : 'light'}
          onChange={onTheme}
          options={[
            { value: 'light', label: '淺色', icon: <Sun className="size-4" /> },
            { value: 'dark', label: '深色', icon: <Moon className="size-4" /> },
          ]}
        />
        <Choice
          label="介面風格"
          value={draft.ui.style === 'notebook' ? 'notebook' : 'default'}
          onChange={onStyle}
          options={[
            { value: 'default', label: '簡約', icon: <Sparkles className="size-4" /> },
            { value: 'notebook', label: '筆記本', icon: <NotebookPen className="size-4" /> },
          ]}
        />
      </div>

      <h3 className="mt-7 mb-2 text-sm font-semibold">環境檢查</h3>
      {health.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 className="size-4 animate-spin" />
          檢查中…
        </div>
      ) : failed.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          {checks.length} 項檢查全部通過
        </div>
      ) : (
        <ul className="space-y-2">
          {failed.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {c.optional ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
              <div className="min-w-0">
                <div>{c.label}</div>
                {c.fix && <div className="text-xs text-ink-2">→ {c.fix}</div>}
              </div>
            </li>
          ))}
          <li className="text-xs text-ink-3">
            {checks.length - failed.length} 項通過。修好後可以在 設定 → 整合 重新檢查。
            <Button size="sm" variant="ghost" className="ml-1" onClick={() => void health.refetch()} loading={health.isFetching}>
              重新檢查
            </Button>
          </li>
        </ul>
      )}

      <div className="mt-7 rounded-ctl bg-accent-soft px-4 py-3 text-sm text-accent">
        <div className="font-semibold">最後一步：開一個新的 Claude Code 對話</div>
        <div className="mt-0.5 text-ink-2">安裝前就開著的對話不會被記錄。之後每次 Claude 回應結束時，Worktrail 會自動記下時間、單號與 commit。</div>
      </div>
    </>
  );
}

function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; icon: ReactNode }[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-ink-2">{label}</div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex h-11 items-center justify-center gap-2 rounded-ctl border text-sm transition-colors duration-150',
              value === o.value ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
