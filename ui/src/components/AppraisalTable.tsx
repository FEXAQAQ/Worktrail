/**
 * 年度考核表（performance/appraisal）的預覽：照公司考核表「I. 工作專案與日常任務」的三欄排成表格，
 * 每格顯示的就是要貼進 Excel 儲存格的純文字，右上角一鍵複製。
 */
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { APPRAISAL_COLUMNS, type AppraisalRow } from '../lib/appraisal';
import { useToast } from '../lib/app';
import { cx } from './ui';

export function AppraisalTable({ title, rows }: { title: string | null; rows: AppraisalRow[] }) {
  return (
    <div className="@container">
      {title && <h1 className="mb-1 text-lg font-bold tracking-tight">{title}</h1>}
      <p className="mb-4 text-xs text-ink-3">對照考核表「I. 工作專案與日常任務」：滑到儲存格上，按右上角的複製圖示，貼到 Excel 對應的儲存格即可。</p>
      <div className="overflow-hidden rounded-ctl border border-line">
        <div className="hidden grid-cols-[8rem_minmax(0,1fr)_minmax(0,1.3fr)] border-b border-line bg-hover text-xs font-semibold text-ink-2 @3xl:grid">
          {APPRAISAL_COLUMNS.map((c, i) => (
            <div key={c} className={cx('px-3 py-2', i > 0 && 'border-l border-line')}>
              {c}
            </div>
          ))}
        </div>
        {rows.map((r, i) => (
          <div
            key={`${r.project}-${i}`}
            className={cx('grid grid-cols-1 @3xl:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1.3fr)]', i > 0 && 'border-t border-line')}
          >
            <Cell label={APPRAISAL_COLUMNS[0]} text={r.project} strong />
            <Cell label={APPRAISAL_COLUMNS[1]} text={r.items} className="@3xl:border-l" />
            <Cell label={APPRAISAL_COLUMNS[2]} text={r.result} className="@3xl:border-l" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Clipboard API 被拒（非安全來源、權限政策）時，退回選取隱藏文字框再 execCommand('copy') */
async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw e;
  }
}

function Cell({ label, text, strong, className }: { label: string; text: string; strong?: boolean; className?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await writeClipboard(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      toast.show({ tone: 'success', message: `已複製「${label}」，貼到 Excel 儲存格即可` });
    } catch (e) {
      toast.show({ tone: 'error', message: `複製失敗：${(e as Error).message}` });
    }
  };

  return (
    <div
      className={cx(
        'group relative min-w-0 border-line py-3 pr-10 pl-4 transition-colors not-first:border-t hover:bg-hover/40 @3xl:not-first:border-t-0',
        className,
      )}
    >
      <div className="mb-1 text-[11px] font-medium text-ink-3 @3xl:hidden">{label}</div>
      {text && (
        <button
          type="button"
          onClick={() => void copy()}
          title={`複製「${label}」`}
          aria-label={`複製「${label}」`}
          className={cx(
            'absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-ctl border border-line bg-card shadow-sm transition-all',
            'focus-visible:opacity-100',
            copied ? 'text-success opacity-100' : 'text-ink-3 opacity-0 group-hover:opacity-100 hover:text-accent',
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
      {text ? (
        <div className={cx('text-[13px] leading-relaxed break-words whitespace-pre-wrap', strong && 'font-semibold')}>{text}</div>
      ) : (
        <div className="text-[13px] text-ink-3">（空白）</div>
      )}
    </div>
  );
}
