"use client";

import { useState } from "react";

/** Série única ao longo do tempo (linha 2px, marcadores, crosshair + tooltip). Valores nulos quebram a linha. */
export function TrendLine({
  points,
  max = 100,
  label,
}: {
  points: { x: string; y: number | null }[];
  max?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560,
    H = 170,
    pad = { l: 32, r: 12, t: 12, b: 24 };
  const n = Math.max(points.length - 1, 1);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / n;
  const y = (v: number) => pad.t + ((max - v) * (H - pad.t - pad.b)) / max;
  let d = "";
  points.forEach((p, i) => {
    if (p.y === null) return;
    const prev = points[i - 1];
    d += `${!prev || prev.y === null ? "M" : "L"}${x(i)},${y(p.y)} `;
  });
  const h = hover !== null ? points[hover] : null;
  const ticks = [0, max / 2, max];
  if (!points.some((p) => p.y !== null))
    return <p className="py-10 text-center text-sm text-ink-soft">Sem dados no período.</p>;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={label}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(
            Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * n))),
          );
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-line" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-soft text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {[0, points.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i ? "end" : "start"}
            className="fill-ink-soft text-[10px]"
          >
            {fmtWeek(points[i]!.x)}
          </text>
        ))}
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          className="text-brand"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {points.map((p, i) =>
          p.y === null ? null : (
            <circle key={i} cx={x(i)} cy={y(p.y)} r={4} className="fill-brand stroke-white" strokeWidth={2} />
          ),
        )}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.t}
            y2={H - pad.b}
            stroke="currentColor"
            className="text-ink-soft"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <div className="font-semibold tabular-nums">{h.y === null ? "sem dados" : h.y}</div>
          <div className="text-ink-soft">semana de {fmtWeek(h.x)}</div>
        </div>
      )}
    </div>
  );
}

/** Barras verticais de contagem (série única), com tooltip por barra. */
export function WeeklyBars({ points, label }: { points: { x: string; y: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560,
    H = 170,
    pad = { l: 28, r: 8, t: 12, b: 24 };
  const max = Math.max(1, ...points.map((p) => p.y));
  const bw = (W - pad.l - pad.r) / Math.max(points.length, 1);
  const y = (v: number) => pad.t + ((max - v) * (H - pad.t - pad.b)) / max;
  if (!points.some((p) => p.y > 0))
    return <p className="py-10 text-center text-sm text-ink-soft">Sem dados no período.</p>;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-line" />
        <text x={pad.l - 6} y={y(max) + 4} textAnchor="end" className="fill-ink-soft text-[10px]">
          {max}
        </text>
        {points.map((p, i) => {
          const h = y(0) - y(p.y);
          const bx = pad.l + i * bw + 1;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {p.y > 0 && (
                <rect
                  x={bx}
                  y={y(p.y)}
                  width={Math.max(bw - 2, 1)}
                  height={h}
                  rx={Math.min(4, bw / 2)}
                  className={hover === i ? "fill-brand" : "fill-brand/80"}
                />
              )}
            </g>
          );
        })}
        {[0, points.length - 1].map((i) => (
          <text
            key={i}
            x={pad.l + i * bw + (i ? bw : 0)}
            y={H - 6}
            textAnchor={i ? "end" : "start"}
            className="fill-ink-soft text-[10px]"
          >
            {fmtWeek(points[i]!.x)}
          </text>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: `${((pad.l + (hover + 0.5) * bw) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <div className="font-semibold tabular-nums">{points[hover]!.y}</div>
          <div className="text-ink-soft">semana de {fmtWeek(points[hover]!.x)}</div>
        </div>
      )}
    </div>
  );
}

/** Ranking horizontal (rótulo + barra + valor em texto). */
export function RankBars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-sm text-ink-soft">Nenhum risco aberto.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li
          key={i.label}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm"
        >
          <span className="truncate">{i.label}</span>
          <span className="tabular-nums text-ink-soft">{i.value}</span>
          <div className="col-span-2 h-1.5 rounded-full bg-line">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function fmtWeek(s: string) {
  const [, m, d] = s.split("-");
  return `${d}/${m}`;
}
