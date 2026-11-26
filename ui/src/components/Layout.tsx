/**
 * 規格 11.3：左側導覽列（220 px，可收合成 64 px）；寬度 < 768 px 時改為頂部選單。
 *
 * 版面：
 * - 上方主要導覽：待補摘要（有待補時才出現，排第一個，右側顯示數量）、今日、日誌、報告、提示詞。 * - 底部：設定，右側是收合按鈕；收合時兩者上下排列。主題（淺色／深色）在設定頁切換。
 * - 收合時只剩圖示，待補數量改成圖示右上角的小標。
 */
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronsLeft, ChevronsRight, FileText, Inbox, Menu, NotebookPen, Search, Settings, Sparkles, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { get } from '../lib/api';
import { useToast } from '../lib/app';
import { cx, IconButton, LinkButton } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof CalendarDays;
  end?: boolean;
  /** 這些路徑開頭都算同一個項目（小交流、週報、績效合併為「報告」，頁內以分頁切換，小交流在最左邊） */
  match?: string[];
  /** 右側的數量標記 */
  badge?: number;
}

const PENDING_ITEM: NavItem = { to: '/pending', label: '待補摘要', icon: Inbox };

const NAV: NavItem[] = [
  { to: '/', label: '今日', icon: CalendarDays, end: true },
  { to: '/log', label: '日誌', icon: NotebookPen },
  { to: '/talk', label: '報告', icon: FileText, match: ['/talk', '/weekly', '/performance'] },
  { to: '/prompts', label: '提示詞', icon: Sparkles },
];

function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  return (item.match ?? [item.to]).some((p) => pathname.startsWith(p));
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('wt.nav.collapsed') === '1';
  } catch {
    return false;
  }
}


export function Layout({ children, onOpenPalette }: { children: ReactNode; onOpenPalette: () => void }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useQuery({ queryKey: ['health'], queryFn: () => get('/api/health'), refetchInterval: 60_000 });
  const pending: number = health.data?.pending_summaries ?? 0;
  const location = useLocation();
  const wide = /^\/(weekly|performance|talk|prompts|log)/.test(location.pathname);
  const section = location.pathname.split('/')[1] ?? '';
  // 待補摘要只在有待補（或正在看這一頁）時出現，排在第一個
  const nav: NavItem[] = pending > 0 || location.pathname.startsWith('/pending') ? [{ ...PENDING_ITEM, badge: pending }, ...NAV] : NAV;
  const activeIndex = nav.findIndex((n) => isNavActive(n, location.pathname));

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('wt.nav.collapsed', c ? '0' : '1');
      } catch {
        // 忽略
      }
      return !c;
    });
  };

  const itemClass = (isActive: boolean, mobile: boolean) =>
    cx(
      'relative flex h-9 items-center gap-3 rounded-ctl px-2.5 text-sm transition-colors duration-200',
      isActive ? 'font-semibold text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink',
      // 行動版選單沒有滑動底色，直接標示目前頁面
      isActive && mobile && 'bg-accent-soft',
    );

  const renderItem = (item: NavItem, onPick?: () => void, standalone = false) => {
    const { to, label, icon: Icon, end, badge } = item;
    const isActive = isNavActive(item, location.pathname);
    const mobile = !!onPick;
    return (
      <NavLink
        key={to}
        to={to}
        end={end}
        onClick={onPick}
        title={collapsed && !mobile ? (badge ? `${label}（${badge}）` : label) : undefined}
        aria-current={isActive ? 'page' : undefined}
        // standalone：不在滑動底色的範圍內（底部的設定），自己畫選取底色
        className={() => cx(itemClass(isActive, mobile), standalone && isActive && 'bg-accent-soft')}
      >
        <span className="relative shrink-0">
          <Icon className="size-4.5" />
          {!!badge && collapsed && !mobile && <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-warn px-1 text-center text-[10px] leading-4 font-bold text-card">{badge > 99 ? '99+' : badge}</span>}
        </span>
        <span className={cx('flex-1', !mobile && 'nav-label')}>{label}</span>
        {!!badge && (!collapsed || mobile) && <span className="rounded-full bg-warn-soft px-1.5 text-2xs leading-5 font-bold text-warn">{badge}</span>}
      </NavLink>
    );
  };

  const settingsItem: NavItem = { to: '/settings', label: '設定', icon: Settings };

  return (
    <div className="flex h-full">
      {/* 桌面：左側導覽 */}
      <aside className={cx('wt-nav nav-rail hidden shrink-0 flex-col overflow-hidden border-r border-line bg-card md:flex', collapsed ? 'is-collapsed w-16' : 'w-[220px]')}>
        {/* 書名置中；收合時只剩字首 */}
        <div className="flex h-14 items-center justify-center px-3">
          <div className="wt-brand text-sm font-bold whitespace-nowrap">{collapsed ? 'W' : 'Worktrail'}</div>
        </div>
        <button
          onClick={onOpenPalette}
          className="wt-search mx-3 mb-3 flex h-9 items-center gap-2 rounded-ctl border border-line px-[11px] text-xs text-ink-3 hover:bg-hover"
          title="搜尋（Ctrl+K）"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="nav-label flex flex-1 items-center">
            <span className="flex-1 text-left">搜尋…</span>
            <kbd className="font-mono text-2xs">Ctrl K</kbd>
          </span>
        </button>
        <nav className="relative flex flex-col gap-0.5 px-3" aria-label="主要導覽">
          {/* 目前頁面的底色：切換頁面時在項目之間滑動（項目高 36 px、間距 2 px） */}
          <div
            aria-hidden="true"
            className="nav-indicator pointer-events-none absolute inset-x-3 top-0 h-9 rounded-ctl bg-accent-soft"
            style={{ transform: `translateY(${Math.max(activeIndex, 0) * 38}px)`, opacity: activeIndex < 0 ? 0 : 1 }}
          />
          {nav.map((item) => renderItem(item))}
        </nav>

        <div className={cx('wt-nav-foot mt-auto flex gap-1 border-t border-line p-3', collapsed ? 'flex-col' : 'items-center')}>
          <div className="min-w-0 flex-1">{renderItem(settingsItem, undefined, true)}</div>
          <IconButton
            className={cx('size-9 shrink-0 text-ink-3', collapsed && 'mx-auto')}
            onClick={toggle}
            title={collapsed ? '展開導覽列' : '收合導覽列'}
            aria-label={collapsed ? '展開導覽列' : '收合導覽列'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </IconButton>
        </div>
      </aside>

      <div className="wt-sheet flex min-w-0 flex-1 flex-col">
        {/* 行動裝置：頂部選單 */}
        <header className="flex h-12 items-center justify-between border-b border-line bg-card px-4 md:hidden">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-6" />
            <span className="text-sm font-bold">Worktrail</span>
          </div>
          <div className="flex items-center gap-1">
            <IconButton size="lg" className="text-ink-2" onClick={onOpenPalette} aria-label="搜尋">
              <Search className="size-4" />
            </IconButton>
            <IconButton size="lg" className="text-ink-2" onClick={() => setMobileOpen((o) => !o)} aria-label="選單">
              {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </IconButton>
          </div>
        </header>
        {mobileOpen && (
          <nav className="fade-in flex flex-col gap-0.5 border-b border-line bg-card p-3 md:hidden">
            {nav.map((item) => renderItem(item, () => setMobileOpen(false)))}
            <div className="my-2 border-t border-line" />
            {renderItem(settingsItem, () => setMobileOpen(false))}
          </nav>
        )}
        <main className="min-h-0 flex-1 overflow-auto">
          <div key={section} className={cx('page-in mx-auto px-4 py-6 md:px-8 md:py-8', wide ? 'max-w-none' : 'max-w-[960px]')}>
            {children}
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-(--z-toast) flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'fade-in pointer-events-auto flex items-center gap-3 rounded-ctl px-4 py-2.5 text-sm shadow-pop',
            t.tone === 'error' ? 'bg-danger text-card' : 'bg-ink text-page',
          )}
        >
          <span>{t.message}</span>
          {t.action && (
            <LinkButton
              className="ml-0"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </LinkButton>
          )}
          <button className="rounded-sm opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="關閉">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
