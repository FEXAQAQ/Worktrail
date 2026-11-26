/**
 * 基本元件：按鈕、輸入框、卡片、標籤、骨架、空狀態、對話框。
 * 規格 11.2：卡片圓角 12、按鈕與輸入框 8、標籤 999；單一強調色。
 * 顏色一律用 styles.css 的 token（accent／ink／danger／warn／success…），不要直接寫 Tailwind 色票或色碼，
 * 否則深色與筆記本風格不會跟著換。
 */
import { AlertCircle, AlertTriangle, Check, Circle, Clock, Folder, Loader2, Minus, X } from 'lucide-react';
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { ItemStatus } from '../lib/api';
import { STATUS_LABEL } from '../lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-ctl font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-on-accent hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-card text-ink hover:bg-hover',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        variant === 'soft' && 'bg-accent-soft text-accent hover:opacity-90',
        variant === 'danger' && 'border border-danger-line bg-card text-danger hover:bg-danger-soft',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

/** 只有圖示的按鈕（關閉、刪除、切換月份等）。size 對應內距：xs 2、sm 4、md 6、lg 8 px */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'xs' | 'sm' | 'md' | 'lg'; tone?: 'default' | 'danger' }>(
  function IconButton({ size = 'sm', tone = 'default', className, type = 'button', children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          'inline-flex shrink-0 items-center justify-center rounded-ctl text-ink-3 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30',
          ICON_PAD[size],
          tone === 'danger' ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-hover hover:text-ink',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
const ICON_PAD = { xs: 'p-0.5', sm: 'p-1', md: 'p-1.5', lg: 'p-2' } as const;

/** 文字連結樣式的按鈕（Banner、toast 裡的動作） */
export function LinkButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx('ml-2 font-semibold underline underline-offset-2', className)} {...rest} />;
}

/** 分段切換（編輯／預覽／並排） */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: string; icon?: ReactNode }[] }) {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('inline-flex h-7 items-center gap-1.5 rounded-ctl px-2.5 text-xs transition-colors duration-150', value === o.value ? 'bg-hover font-semibold text-ink' : 'text-ink-3 hover:text-ink')}
          aria-pressed={value === o.value}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </>
  );
}

/** 表單下方的錯誤訊息 */
export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cx('text-xs text-danger', className)}>
      {children}
    </div>
  );
}

/** 無框、滑過才出現底色的大標題輸入框（任務面板、小交流） */
export const TITLE_FIELD = '-mx-2 w-[calc(100%+1rem)] rounded-ctl bg-transparent px-2 py-1 text-lg font-bold leading-snug outline-none placeholder:text-ink-3 hover:bg-hover focus:bg-hover';

/** 輸入框外觀，給不能直接用 <Input> 的地方（例如自訂下拉輸入）；邊框色另外加 border-line */
export const INPUT_CLASS = 'h-9 w-full rounded-ctl border bg-card px-3 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        INPUT_CLASS,
        invalid ? 'border-danger' : 'border-line',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        'w-full rounded-ctl border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx('h-9 rounded-ctl border border-line bg-card px-2.5 text-sm text-ink focus:border-accent focus:outline-none', className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Card({ className, children, dashed, ...rest }: { className?: string; children: ReactNode; dashed?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('wt-card rounded-card border bg-card', dashed ? 'is-dashed border-dashed border-ink-3/60' : 'border-line', className)} {...rest}>
      {children}
    </div>
  );
}

export function Tag({
  children,
  className,
  mono,
  tone = 'default',
  ...rest
}: { children: ReactNode; className?: string; mono?: boolean; tone?: 'default' | 'warn' } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        'wt-tag inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-hover text-ink-2',
        mono && 'font-mono',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

const PROJECT_COLORS = 8;

/** 依專案名稱固定對應色票編號（同名專案在每個頁面、每次開啟都是同一個顏色） */
export function projectColor(name: string): { fg: string; soft: string } {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  const i = (h >>> 0) % PROJECT_COLORS;
  return { fg: `var(--p${i})`, soft: `var(--p${i}-soft)` };
}

/** 專案標籤：所有頁面共用，外觀一致。依專案名稱上色，未分類為灰色 */
export function ProjectTag({ name, icon, className }: { name: string | null | undefined; icon?: ReactNode; className?: string }) {
  const color = name ? projectColor(name) : { fg: 'var(--ink-2)', soft: 'var(--hover)' };
  return (
    <span
      className={cx(
        'wt-tag wt-project inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        className,
      )}
      style={{ color: color.fg, background: color.soft }}
    >
      {icon ?? <Folder className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{name || '未分類'}</span>
    </span>
  );
}

/** 規格 11.2：狀態同時以圖示＋文字＋顏色表示 */
const STATUS_STYLE: Record<ItemStatus, string> = {
  done: 'bg-success-soft text-success',
  pending: 'bg-warn-soft text-warn',
  todo: 'bg-hover text-ink-2',
  skipped: 'bg-muted-soft text-muted',
  blocked: 'bg-danger-soft text-danger',
};
const STATUS_ICON: Record<ItemStatus, typeof Check> = { done: Check, pending: Clock, todo: Circle, skipped: Minus, blocked: AlertCircle };

export function StatusBadge({ status, onClick, className }: { status: ItemStatus; onClick?: () => void; className?: string }) {
  const Icon = STATUS_ICON[status];
  const cls = cx('wt-status inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[status], onClick && 'cursor-pointer hover:ring-1 hover:ring-current', className);
  const content = (
    <>
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
      {STATUS_LABEL[status]}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title="點擊切換狀態">
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-line px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-base font-semibold">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-(--z-modal) flex items-center justify-center bg-overlay p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label={title} className={cx('w-full rounded-card border border-line bg-card shadow-overlay', wide ? 'max-w-3xl' : 'max-w-md')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton onClick={onClose} aria-label="關閉">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-auto px-5 py-4 text-sm">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel = '確定',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Modal>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <div className="mb-1 text-xs font-medium text-ink-2">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </label>
  );
}

/** 頁面主標題（h1）：所有頁面共用，筆記本風格會套上手寫字＋螢光筆 */
export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cx('wt-heading text-xl font-bold tracking-tight', className)}>{children}</h1>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <PageTitle>{title}</PageTitle>
        {subtitle && <div className="mt-1 text-sm text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Banner({ tone, children, className }: { tone: 'warn' | 'info' | 'danger'; children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'flex items-start gap-2 rounded-ctl px-4 py-2.5 text-sm',
        tone === 'warn' ? 'bg-warn-soft text-warn' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent',
        className,
      )}
    >
      {tone === 'danger' ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}
