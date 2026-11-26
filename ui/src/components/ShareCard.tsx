/**
 * 一鍵快照：專用分享版型（固定寬度、一律淺色、無按鈕與編輯元件）與「複製圖片」按鈕。
 * 按下時才在畫面外渲染卡片，轉成 PNG 放進剪貼簿，可直接貼到 Telegram。見 DECISIONS.md「一鍵快照」。
 */
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { forwardRef, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { get, type Stats } from '../lib/api';
import { useToast } from '../lib/app';
import { fmtHours, pct } from '../lib/format';
import { formatStamp, isTooLongForTelegram, SHARE_WIDTH, shareFileName, splitLeadingHeading } from '../lib/share';
import { downloadBlob, renderPng, writePngToClipboard } from '../lib/snapshot';
import { ProjectDonut } from './Charts';
import { MarkdownView } from './Editor';
import { Button } from './ui';

export interface ShareContent {
  /** 卡片左上角的種類標記，例如「週報」「小交流」 */
  kind: string;
  /** 內文開頭沒有一級標題時使用的標題 */
  title: string;
  /** 期間或日期 */
  subtitle: string;
  stats: Stats;
  text: string;
  /** 是否放專案時數環圈圖 */
  donut?: boolean;
}

const ShareCard = forwardRef<HTMLDivElement, { content: ShareContent; userName: string; stamp: string }>(function ShareCard({ content, userName, stamp }, ref) {
  const { heading, body } = splitLeadingHeading(content.text);
  const s = content.stats;
  const stats = [
    { label: '總時數', value: fmtHours(s.total_hours) },
    { label: '任務', value: `${s.task_count}` },
    { label: '完成率', value: pct(s.completion_rate) },
  ];
  return (
    <div ref={ref} className="force-light bg-card p-8 font-sans text-sm text-ink" style={{ width: SHARE_WIDTH }}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-semibold text-accent">{content.kind}</span>
        <span className="font-semibold tracking-wide text-ink-3">Worktrail</span>
      </div>
      <div className="wt-heading mt-3 text-xl leading-tight font-bold">{heading ?? content.title}</div>
      <div className="mt-1.5 text-xs text-ink-3">
        {content.subtitle}
        {userName && `・${userName}`}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {stats.map((x) => (
          <div key={x.label} className="rounded-ctl bg-page px-3 py-2.5">
            <div className="text-xs text-ink-3">{x.label}</div>
            <div className="mt-0.5 text-lg font-bold">{x.value}</div>
          </div>
        ))}
      </div>
      {content.donut && s.hours_by_project.length > 0 && (
        <div className="mt-4 rounded-ctl border border-line p-3">
          <div className="mb-1 text-xs text-ink-3">專案時數分布</div>
          <ProjectDonut data={s.hours_by_project} />
        </div>
      )}

      {body.trim() && (
        <div className="mt-6 border-t border-line pt-5">
          <MarkdownView text={body} />
        </div>
      )}

      <div className="mt-6 border-t border-line pt-3 text-2xs text-ink-3">Worktrail・產生於 {stamp}</div>
    </div>
  );
});

export function SnapshotButton({ content, disabled }: { content: ShareContent; disabled?: boolean }) {
  const toast = useToast();
  const config = useQuery({ queryKey: ['config'], queryFn: () => get<{ config: { user_name?: string } }>('/api/config') });
  const [job, setJob] = useState<{ stamp: string } | null>(null);
  const resolveNode = useRef<((el: HTMLElement) => void) | null>(null);

  // 卡片掛上後等一小段時間（Recharts 的 ResponsiveContainer 需要量測尺寸）再交出節點。
  // 用 setTimeout 而非 requestAnimationFrame：視窗在背景或被遮住時 rAF 會暫停，截圖就卡住。
  const cardRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || !resolveNode.current) return;
    const resolve = resolveNode.current;
    resolveNode.current = null;
    setTimeout(() => resolve(el), 150);
  }, []);

  const snap = () => {
    const now = new Date();
    const node = new Promise<HTMLElement>((r) => (resolveNode.current = r));
    setJob({ stamp: formatStamp(now) });
    let height = 0;
    const png = node.then((el) => {
      height = el.offsetHeight;
      return renderPng(el);
    });
    const done = () => setJob(null);

    // 同步呼叫剪貼簿，保留使用者手勢；失敗再退回下載
    writePngToClipboard(png)
      .then(() => {
        toast.show({
          tone: 'success',
          message: isTooLongForTelegram(height) ? '已複製圖片。內容較長，貼到 Telegram 時建議取消勾選「壓縮圖片」以原圖傳送' : '已複製圖片',
          duration: isTooLongForTelegram(height) ? 8000 : undefined,
        });
      })
      .catch(async (e: unknown) => {
        try {
          const blob = await png;
          downloadBlob(shareFileName(content.title, now), blob);
          toast.show({ message: `無法寫入剪貼簿，已改為下載圖片（${(e as Error)?.message ?? e}）` });
        } catch (err) {
          toast.show({ tone: 'error', message: `產生圖片失敗：${(err as Error)?.message ?? err}` });
        }
      })
      .finally(done);
  };

  return (
    <>
      <Button variant="ghost" icon={<Camera className="size-4" />} loading={!!job} disabled={disabled} onClick={snap} title="以分享版型複製成圖片，可直接貼到 Telegram">
        複製圖片
      </Button>
      {job &&
        createPortal(
          <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
            <ShareCard ref={cardRef} content={content} userName={config.data?.config?.user_name ?? ''} stamp={job.stamp} />
          </div>,
          document.body,
        )}
    </>
  );
}
