// SVG-графики для аналитики (server-safe, без клиентского JS/библиотек).
// Стиль: фирменный оранжевый + спокойная палитра; tabular-nums; скругления.

/** Бар-чарт (вертикальные столбцы, HTML/CSS — без SVG-растяжений). */
export function BarChart({
  data,
  height = 170,
  formatValue,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex min-w-[480px] items-end gap-2" style={{ height }}>
        {data.map((d, i) => {
          const hPct = d.value > 0 ? Math.max((d.value / max) * 100, 2) : 0;
          return (
            <div key={`${d.label}-${i}`} className="flex min-w-16 flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
              {d.value > 0 && (
                <span className="text-[11px] font-semibold tabular-nums text-muted">
                  {formatValue ? formatValue(d.value) : d.value}
                </span>
              )}
              <div
                title={`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}
                className="w-full max-w-14 rounded-t-base transition-[height] duration-500"
                style={{ height: `${hPct}%`, backgroundColor: d.color ?? "#EA7A28", minHeight: d.value > 0 ? 4 : 0 }}
                role="img"
                aria-label={`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}
              />
              <span className="w-full truncate text-center text-[11px] text-muted">{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Кольцевой индикатор (donut gauge) — процент + значение в центре. */
export function Donut({
  pct,
  label,
  sub,
  color = "#EA7A28",
  size = 120,
}: {
  pct: number; // 0..1
  label: string;
  sub?: string;
  color?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  const r = 15.9155; // окружность 100
  const dash = clamped * 100;
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label={`${label}: ${Math.round(clamped * 100)}%`}>
        <circle cx="21" cy="21" r={r} fill="none" stroke="#f1f5f9" strokeWidth="4.5" />
        <circle
          cx="21" cy="21" r={r} fill="none" stroke={color} strokeWidth="4.5"
          strokeDasharray={`${dash} ${100 - dash}`} strokeLinecap="round"
          transform="rotate(-90 21 21)"
          style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.22,1,0.36,1)" }}
        />
        <text x="21" y="22.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#0f172a">
          {Math.round(clamped * 100)}%
        </text>
      </svg>
      <p className="mt-1 text-xs font-semibold text-ink">{label}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

/** Горизонтальный стек-бар (воронка статусов) с цветами по статусам. */
export function StackBar({
  data,
  height = 26,
}: {
  data: Array<{ label: string; value: number; color: string }>;
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-base" style={{ height }}>
        {data.map((d) => {
          const w = (d.value / total) * 100;
          if (w <= 0) return null;
          return (
            <div
              key={d.label}
              title={`${d.label}: ${d.value}`}
              style={{ width: `${w}%`, backgroundColor: d.color }}
              className="flex items-center justify-center text-[10px] font-bold text-white"
            >
              {w >= 12 ? d.value : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {data.map((d) => (
          <span key={d.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            {d.label}: <b className="text-ink">{d.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Компактный спарклайн (линия с заливкой). */
export function Sparkline({
  points,
  height = 60,
  color = "#EA7A28",
}: {
  points: number[];
  height?: number;
  color?: string;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const W = 100;
  const H = height - 8;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((p - min) / range) * (H - 6) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polygon points={`0,${H} ${coords.join(" ")} ${W},${H}`} fill={color} opacity="0.12" />
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
