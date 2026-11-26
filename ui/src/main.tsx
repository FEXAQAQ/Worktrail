import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { get } from './lib/api';
import { CommandPalette } from './components/CommandPalette';
import { Layout } from './components/Layout';
import { Skeleton } from './components/ui';
import { AppProviders, useHotkey } from './lib/app';
import { LogPage } from './pages/Log';
import { PendingPage } from './pages/Pending';
import { TodayPage } from './pages/Today';
import './styles.css';

// 編輯器與圖表較大，延遲載入
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const TalkPage = lazy(() => import('./pages/Talk').then((m) => ({ default: m.TalkPage })));
const PromptsPage = lazy(() => import('./pages/Prompts').then((m) => ({ default: m.PromptsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const WelcomePage = lazy(() => import('./pages/Welcome').then((m) => ({ default: m.WelcomePage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } },
});

function App() {
  const [palette, setPalette] = useState(false);
  const location = useLocation();
  const config = useQuery({ queryKey: ['config'], queryFn: () => get('/api/config') });
  useHotkey('k', (e) => {
    e.preventDefault();
    setPalette((p) => !p);
  }, { ctrl: true, allowInInput: true });
  // 首次引導：新安裝時（ui.onboarding = pending）先顯示，設定頁也可以從 /welcome 重新執行
  if (config.isLoading) return null;
  if (config.data?.config?.ui?.onboarding === 'pending' || location.pathname === '/welcome') {
    return (
      <Suspense fallback={null}>
        <WelcomePage />
      </Suspense>
    );
  }
  return (
    <>
      <Layout onOpenPalette={() => setPalette(true)}>
        <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/log" element={<LogPage />} />
          <Route path="/pending" element={<PendingPage />} />
          <Route path="/weekly" element={<ReportsPage type="weekly" />} />
          <Route path="/weekly/:period" element={<ReportsPage type="weekly" />} />
          <Route path="/performance" element={<ReportsPage type="performance" />} />
          <Route path="/performance/:period" element={<ReportsPage type="performance" />} />
          <Route path="/talk" element={<TalkPage />} />
          <Route path="/talk/:id" element={<TalkPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/prompts/:type/:name" element={<PromptsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<TodayPage />} />
        </Routes>
        </Suspense>
      </Layout>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </>
  );
}

/** 開場動畫長度，與 splash.css 的時間軸一致 */
const INTRO_MS = 2200;

/** 開場動畫播完後淡出（第一次約 2.2 秒；同一視窗重新整理時立即淡出） */
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const seen = (window as { __WT_INTRO_SEEN__?: boolean }).__WT_INTRO_SEEN__;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = seen || reduce ? 0 : Math.max(0, INTRO_MS - performance.now());
  setTimeout(() => {
    el.classList.add('done');
    try {
      sessionStorage.setItem('wt.intro', '1');
    } catch {
      // 忽略
    }
    setTimeout(() => el.remove(), 550);
  }, wait);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppProviders>
          <App />
        </AppProviders>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

hideSplash();
