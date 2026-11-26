/**
 * 規格 11.4：專案時數分布（環圈圖）、各週時數趨勢（長條圖）。Recharts。
 * 專案顏色與專案標籤相同（projectColor），在各頁面能對得起來。
 */
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtHours, pct } from '../lib/format';
import { projectColor } from './ui';

/** 圖表 tooltip 與 Heatmap 的 tooltip 同一個外觀（卡片底、ctl 圓角、pop 陰影） */
const TOOLTIP_STYLE = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--radius-ctl)', boxShadow: 'var(--shadow-pop)', fontSize: 12, color: 'var(--ink)' };
/** 座標軸刻度：text-2xs（11px） */
const TICK = { fontSize: 11, fill: 'var(--ink-3)' };

export function ProjectDonut({ data }: { data: { project: string; hours: number; ratio: number }[] }) {
  if (!data.length) return <div className="flex h-40 items-center justify-center text-xs text-ink-3">沒有資料</div>;
  return (
    <div className="flex items-center gap-4">
      <div className="h-36 w-36 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="hours" nameKey="project" innerRadius="62%" outerRadius="100%" strokeWidth={2} stroke="var(--card)" isAnimationActive={false}>
              {data.map((p) => (
                <Cell key={p.project} fill={projectColor(p.project).fg} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, n) => [fmtHours(Number(v ?? 0)), String(n)]}
              contentStyle={TOOLTIP_STYLE}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.slice(0, 6).map((p) => (
          <li key={p.project} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: projectColor(p.project).fg }} />
            <span className="min-w-0 flex-1 truncate">{p.project}</span>
            <span className="text-ink-2">{fmtHours(p.hours)}</span>
            <span className="w-9 text-right text-ink-3">{pct(p.ratio)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeeklyTrend({ data }: { data: { id: string; hours: number }[] }) {
  return (
    <div className="h-40">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <XAxis dataKey="id" tickFormatter={(v: string) => v.replace(/^\d{4}-/, '')} tick={TICK} axisLine={false} tickLine={false} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            formatter={(v) => [fmtHours(Number(v ?? 0)), '時數']}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="hours" fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
