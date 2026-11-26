/**
 * 週報、績效、小交流三個報告頁共用的部分：頁首分頁、狀態標示、範本選單、編輯模式。
 * 三頁在導覽列合併成一個「報告」，以頁首分頁切換。
 */
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { PromptInfo } from '../lib/api';
import { cx, Select } from './ui';

export const REPORT_TABS = [
  { to: '/talk', label: '小交流' },
  { to: '/weekly', label: '週報' },
  { to: '/performance', label: '績效' },
] as const;

/** 報告頁的分頁：小交流／週報／績效，放在「報告」標題下方 */
export function ReportTabs({ className }: { className?: string }) {
  return (
    <nav className={cx('flex items-center gap-1', className)} aria-label="報告類型">
      {REPORT_TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cx(
              'rounded-ctl px-2.5 py-1 text-base transition-colors duration-150',
              isActive ? 'bg-accent-soft font-bold text-accent' : 'font-semibold text-ink-3 hover:bg-hover hover:text-ink',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export const DOC_STATUS: Record<'none' | 'generated' | 'edited' | 'stale', { label: string; cls: string }> = {
  none: { label: '未產生', cls: 'text-ink-3' },
  generated: { label: '已產生', cls: 'text-success' },
  edited: { label: '已編輯', cls: 'text-accent' },
  stale: { label: '資料已變動', cls: 'text-warn' },
};

/**
 * 範本選單：只有一個範本可選時不顯示（大多數人只用預設範本）。
 * 內建範本與安裝時建立的預設範本內容相同，不列入選項（目前選的就是內建範本時例外）。
 * 預設範本統一在 Prompt 頁設定。
 */
export function PromptSelect({ prompts, value, onChange }: { prompts: PromptInfo[]; value: string; onChange: (ref: string) => void }) {
  const options = prompts.filter((p) => !p.builtin || p.ref === value);
  if (options.length < 2) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="提示詞範本">
      {options.map((p) => (
        <option key={p.ref} value={p.ref}>
          {p.title}
          {p.builtin ? '（內建）' : ''}
        </option>
      ))}
    </Select>
  );
}

export type DocMode = 'edit' | 'preview' | 'split';

const MODE_KEY = 'wt.doc.mode';
/** 舊版各頁分開記住的模式，第一次讀取時沿用 */
const LEGACY_KEYS = ['wt.report.mode', 'wt.talk.mode'];

function readMode(): DocMode {
  try {
    const m = localStorage.getItem(MODE_KEY) ?? LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
    return m === 'edit' || m === 'split' ? m : 'preview';
  } catch {
    return 'preview';
  }
}

/** 編輯／預覽／並排模式，三個報告頁共用同一個偏好 */
export function useDocMode(): [DocMode, (m: DocMode) => void] {
  const [mode, setMode] = useState<DocMode>(readMode);
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // 忽略
    }
  }, [mode]);
  return [mode, setMode];
}
