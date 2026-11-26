/**
 * 規格 11.4：年度熱度圖（GitHub 風格，自行以 SVG 實作）。格子深淺代表當天時數。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, fmtHours, weekdayOf } from '../lib/format';

const CELL = 12;
const GAP = 3;
const LEVELS = [0, 1, 3, 5, 7];

function level(h: number): number {
  let l = 0;
  for (let i = 1; i < LEVELS.length; i++) if (h >= LEVELS[i]!) l = i;
  return h > 0 ? Math.max(l, 1) : 0;
}

const FILL = ['var(--hover)', 'color-mix(in oklab, var(--accent) 25%, var(--card))', 'color-mix(in oklab, var(--accent) 50%, var(--card))', 'color-mix(in oklab, var(--accent) 75%, var(--card))', 'var(--accent)'];

export function Heatmap({ end, hoursByDate, selected, onPick }: { end: string; hoursByDate: Map<string, number>; selected?: string | null; onPick: (date: string) => void }) {
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null);
  const { weeks, months } = useMemo(() => {
    // 從 52 週前的週日開始，到 end 所在的週六
    const endSat = addDays(end, 6 - weekdayOf(end));
    const start = addDays(endSat, -(53 * 7 - 1));
    const weeks: string[][] = [];
    for (let w = 0; w < 53; w++) weeks.push(Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
    const months: { x: number; label: string }[] = [];
    let last = '';
    weeks.forEach((wk, i) => {
      const m = wk[0]!.slice(5, 7);
      if (m !== last) {
        months.push({ x: i * (CELL + GAP), label: `${Number(m)}月` });
        last = m;
      }
    });
    return { weeks, months };
  }, [end]);

  const width = weeks.length * (CELL + GAP) + 24;
  const total = [...hoursByDate.values()].reduce((a, b) => a + b, 0);
  // 寬度不足時預設捲到最右（最近的日期）
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [end]);
  return (
    <div className="relative">
      <div ref={scroller} className="overflow-x-auto pb-1">
        <svg width={width} height={7 * (CELL + GAP) + 22} role="img" aria-label={`過去一年共 ${fmtHours(Math.round(total * 10) / 10)}`}>
          <g transform="translate(24, 14)">
            {months.map((m) => (
              <text key={m.x} x={m.x} y={-4} fontSize={10} fill="var(--ink-3)">
                {m.label}
              </text>
            ))}
            {['一', '三', '五'].map((d, i) => (
              <text key={d} x={-20} y={(i * 2 + 1) * (CELL + GAP) + CELL - 2} fontSize={10} fill="var(--ink-3)">
                {d}
              </text>
            ))}
            {weeks.map((wk, wi) =>
              wk.map((date, di) => {
                if (date > end) return null;
                const h = hoursByDate.get(date) ?? 0;
                const x = wi * (CELL + GAP);
                const y = di * (CELL + GAP);
                return (
                  <rect
                    key={date}
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    rx={3}
                    fill={FILL[level(h)]}
                    stroke={selected === date ? 'var(--ink)' : 'transparent'}
                    strokeWidth={1.5}
                    className="cursor-pointer"
                    tabIndex={h > 0 ? 0 : -1}
                    aria-label={`${date}：${fmtHours(h)}`}
                    onClick={() => onPick(date)}
                    onKeyDown={(e) => e.key === 'Enter' && onPick(date)}
                    onMouseEnter={() => setHover({ date, x: x + 24, y })}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              }),
            )}
          </g>
        </svg>
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-(--z-raised) -translate-x-1/2 rounded-ctl border border-line bg-card px-2 py-1 text-xs whitespace-nowrap text-ink shadow-pop"
          style={{ left: hover.x + CELL / 2 - (scroller.current?.scrollLeft ?? 0), top: hover.y - 14 }}
        >
          {hover.date}・{fmtHours(hoursByDate.get(hover.date) ?? 0)}
        </div>
      )}
      <div className="mt-1 flex items-center justify-end gap-1 text-2xs text-ink-3">
        少
        {FILL.map((f, i) => (
          <span key={i} className="inline-block size-2.5 rounded-sm" style={{ background: f }} />
        ))}
        多
      </div>
    </div>
  );
}
