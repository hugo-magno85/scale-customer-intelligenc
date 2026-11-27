"use client";

import type { BiComparison, HealthClass, ReportBi } from "@sci/contracts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/* ------------------------------------------------------------- formatos -- */

export const fmt1 = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Customer Health é guardado em 0–100; o BI exibe em 0–10. */
export const toTen = (v: number | null) => (v === null ? null : Math.round(v) / 10);
export const fmtPct = (v: number) =>
  `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const fmtShare = (v: number) => `${Math.round(v * 100)}%`;
export const fmtDate = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

export const BI = {
  blue: "#2563EB",
  green: "#16B978",
  orange: "#F59E0B",
  red: "#E5485D",
  gray: "#94A3B8",
} as const;

export type Bands = ReportBi["bands"];
export function bandOf(score100: number | null, b: Bands) {
  if (score100 === null) return { label: "Sem dados", color: BI.gray };
  if (score100 >= b.excellentMin) return { label: "Excelente", color: BI.green };
  if (score100 >= b.healthyMin) return { label: "Saudável", color: BI.green };
  if (score100 >= b.attentionMin) return { label: "Atenção", color: BI.orange };
  return { label: "Crítico", color: BI.red };
}
export const CLASS_LABEL: Record<HealthClass, string> = {
  healthy: "Saudável",
  attention: "Atenção",
  high_risk: "Risco alto",
};

/* ---------------------------------------------------------- superfícies -- */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bi-rise min-w-0 rounded-2xl border border-white/70 bg-white/85 p-5 shadow-[0_1px_2px_rgba(15,23,41,0.04),0_8px_24px_-12px_rgba(15,23,41,0.10)] backdrop-blur ${className}`}
    >
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-10 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft">{children}</h2>
      {hint && <span className="text-xs text-ink-soft">{hint}</span>}
    </div>
  );
}

/** Tooltip acessível (foco e mouse). */
export function Tip({ text, children }: { text: string; children?: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-describedby={id}
        className="inline-flex text-ink-soft/70 outline-none hover:text-ink focus-visible:text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        {children ?? <Info size={13} aria-label="Como é calculado" />}
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute right-0 top-5 z-20 w-64 rounded-lg bg-ink px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/** Estado vazio / indisponível — nunca um zero falso. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-line px-4 py-6 text-center">
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-sm text-xs text-ink-soft">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- variação -- */

export type Direction = "up_is_good" | "down_is_good" | "neutral";

export function Delta({
  comparison,
  direction,
  unit = "pct",
}: {
  comparison: BiComparison;
  direction: Direction;
  unit?: "pct" | "abs";
}) {
  if (comparison.status !== "ok" || comparison.delta === null)
    return (
      <span className="text-[11px] text-ink-soft">
        {comparison.status === "not_applicable" ? "Sem comparativo" : "Histórico insuficiente"}
      </span>
    );
  const d = comparison.delta;
  const good = direction === "neutral" || d === 0 ? null : direction === "up_is_good" ? d > 0 : d < 0;
  const color =
    good === null
      ? "text-ink-soft bg-canvas"
      : good
        ? "text-[#0f8a5a] bg-bi-green/10"
        : "text-[#c2304a] bg-bi-red/10";
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : ArrowRight;
  const text =
    unit === "pct" && comparison.deltaPct !== null
      ? fmtPct(comparison.deltaPct)
      : `${d > 0 ? "+" : ""}${d.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${color}`}
    >
      <Icon size={12} aria-hidden />
      {text}
    </span>
  );
}

/* ------------------------------------------------------------ sparkline -- */

export function Sparkline({
  values,
  color = BI.blue,
  height = 28,
}: {
  values: (number | null)[];
  color?: string;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (pts.length < 2) return <div style={{ height }} aria-hidden />;
  const W = 120;
  const max = Math.max(...pts.map((p) => p.v));
  const min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * W;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
  const area = `${line} L${x(pts.at(-1)!.i)},${height} L${x(pts[0]!.i)},${height} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------------------------------------------------- velocímetro -- */

/** Semicírculo 0–10 com as faixas do tenant, preenchimento em gradiente e marcador. */
export function Gauge({ score100, bands }: { score100: number | null; bands: Bands }) {
  const gid = useId().replace(/:/g, "");
  const R = 90;
  const cx = 110;
  const cy = 104;
  const pt = (v: number, r = R) => {
    const a = Math.PI * (1 - v / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number, r = R) => {
    const [x1, y1] = pt(a, r);
    const [x2, y2] = pt(b, r);
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`;
  };
  const segs = [
    [0, bands.attentionMin, BI.red],
    [bands.attentionMin, bands.healthyMin, BI.orange],
    [bands.healthyMin, bands.excellentMin, BI.green],
    [bands.excellentMin, 100, "#0E9F6E"],
  ] as const;
  const v = score100 === null ? null : Math.max(0, Math.min(100, score100));
  const marker = v === null ? null : pt(v, R);
  const band = bandOf(v, bands);
  return (
    <svg
      viewBox="0 0 220 122"
      className="mx-auto w-full max-w-[300px]"
      role="img"
      aria-label={`Customer Health ${v === null ? "sem dados" : fmt1(v / 10)} de 10, ${band.label}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={BI.red} />
          <stop offset={bands.attentionMin / 100} stopColor={BI.orange} />
          <stop offset={bands.healthyMin / 100} stopColor={BI.green} />
          <stop offset="1" stopColor="#0E9F6E" />
        </linearGradient>
      </defs>
      {/* faixas (fundo translúcido) */}
      {segs.map(([a, b, c]) => (
        <path
          key={a}
          d={arc(a + 0.4, b - 0.4)}
          stroke={c}
          strokeOpacity={0.16}
          strokeWidth={16}
          fill="none"
        />
      ))}
      {v !== null && v > 0.5 && (
        <path d={arc(0.2, v)} stroke={`url(#${gid})`} strokeWidth={16} strokeLinecap="round" fill="none" />
      )}
      {[0, bands.attentionMin, bands.healthyMin, bands.excellentMin, 100].map((t) => {
        const [x, y] = pt(t, R + 16);
        return (
          <text key={t} x={x} y={y + 3} textAnchor="middle" className="fill-ink-soft text-[8px] tabular-nums">
            {t / 10}
          </text>
        );
      })}
      {marker && (
        <g>
          <line
            x1={cx}
            y1={cy}
            x2={pt(v!, R - 22)[0]}
            y2={pt(v!, R - 22)[1]}
            stroke="#0f1729"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r={5} fill="#0f1729" />
          <circle cx={marker[0]} cy={marker[1]} r={7} fill="white" stroke={band.color} strokeWidth={3} />
        </g>
      )}
    </svg>
  );
}

/* --------------------------------------------------------------- gráficos -- */

function linearTrend(vals: (number | null)[]) {
  const p = vals.map((v, i) => [i, v] as const).filter((x): x is readonly [number, number] => x[1] !== null);
  if (p.length < 3) return null;
  const n = p.length;
  const sx = p.reduce((s, [x]) => s + x, 0);
  const sy = p.reduce((s, [, y]) => s + y, 0);
  const sxx = p.reduce((s, [x]) => s + x * x, 0);
  const sxy = p.reduce((s, [x, y]) => s + x * y, 0);
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const m = (n * sxy - sx * sy) / den;
  const b = (sy - m * sx) / n;
  return { a: b, b: b + m * (vals.length - 1), slope: m };
}

/** Linha com área translúcida, série do período anterior (tracejada) e tendência linear (≥ 3 pontos). */
export function AreaCompare({
  labels,
  current,
  previous,
  max,
  autoScale = false,
  format,
  ariaLabel,
  currentLabel = "Período",
  previousLabel = "Comparação",
}: {
  labels: string[];
  current: (number | null)[];
  previous: (number | null)[];
  max: number;
  /** Ajusta o eixo à faixa dos dados (com folga), mantendo os valores no eixo. */
  autoScale?: boolean;
  format: (v: number) => string;
  ariaLabel: string;
  currentLabel?: string;
  previousLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  if (!current.some((v) => v !== null))
    return (
      <Empty title="Sem dados no período">As notas aparecem depois das primeiras reuniões analisadas.</Empty>
    );
  const W = 640;
  const H = 220;
  const pad = { l: 34, r: 14, t: 14, b: 26 };
  const n = Math.max(labels.length - 1, 1);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / n;
  const vals = [...current, ...previous].filter((v): v is number => v !== null);
  const lo = autoScale && vals.length ? Math.max(0, Math.floor(Math.min(...vals) - 0.5)) : 0;
  const hi = autoScale && vals.length ? Math.min(max, Math.ceil(Math.max(...vals) + 0.5)) : max;
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo || 1);
  const path = (vals: (number | null)[]) => {
    let d = "";
    vals.forEach((v, i) => {
      if (v === null) return;
      d += `${i === 0 || vals[i - 1] === null ? "M" : "L"}${x(i)},${y(v)} `;
    });
    return d;
  };
  const segs: string[] = [];
  let cur: number[] = [];
  current.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segs.push(areaOf(cur));
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) segs.push(areaOf(cur));
  function areaOf(idx: number[]) {
    return `M${x(idx[0]!)},${y(lo)} ${idx.map((i) => `L${x(i)},${y(current[i]!)}`).join(" ")} L${x(idx.at(-1)!)},${y(lo)} Z`;
  }
  const trend = linearTrend(current);
  const ticks = [lo, (lo + hi) / 2, hi];
  const step = Math.ceil(labels.length / 8);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-[11px] text-ink-soft">
        <Legend color={BI.blue} label={currentLabel} />
        {previous.some((v) => v !== null) && <Legend color={BI.gray} label={previousLabel} dashed />}
        {trend && <Legend color={BI.blue} label="Tendência" dotted />}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={ariaLabel}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            setHover(
              Math.max(0, Math.min(labels.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * n))),
            );
          }}
        >
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={BI.blue} stopOpacity="0.20" />
              <stop offset="1" stopColor={BI.blue} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y(t)}
                y2={y(t)}
                stroke="#E5E8EF"
                strokeDasharray={t ? "3 4" : undefined}
              />
              <text
                x={pad.l - 8}
                y={y(t) + 3}
                textAnchor="end"
                className="fill-ink-soft text-[10px] tabular-nums"
              >
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % step === 0 || i === labels.length - 1 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-ink-soft text-[10px]">
                {l}
              </text>
            ) : null,
          )}
          {segs.map((d, i) => (
            <path key={i} d={d} fill={`url(#${gid})`} />
          ))}
          <path d={path(previous)} fill="none" stroke={BI.gray} strokeWidth={1.6} strokeDasharray="5 5" />
          {trend && (
            <line
              x1={x(0)}
              y1={y(Math.max(0, Math.min(max, trend.a)))}
              x2={x(labels.length - 1)}
              y2={y(Math.max(0, Math.min(max, trend.b)))}
              stroke={BI.blue}
              strokeOpacity={0.55}
              strokeWidth={1.4}
              strokeDasharray="2 4"
            />
          )}
          <path
            d={path(current)}
            fill="none"
            stroke={BI.blue}
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {current.map((v, i) =>
            v === null ? null : (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r={hover === i ? 5 : 3}
                fill="white"
                stroke={BI.blue}
                strokeWidth={2}
              />
            ),
          )}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(lo)} stroke="#0f1729" strokeOpacity={0.15} />
          )}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%` }}
          >
            <div className="font-medium">{labels[hover]}</div>
            <div className="tabular-nums" style={{ color: BI.blue }}>
              {currentLabel}: {current[hover] === null ? "sem dados" : format(current[hover]!)}
            </div>
            <div className="tabular-nums text-ink-soft">
              {previousLabel}: {previous[hover] == null ? "sem histórico" : format(previous[hover]!)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  dashed,
  dotted,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  dotted?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden>
        <line
          x1="0"
          x2="18"
          y1="3"
          y2="3"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashed ? "4 3" : dotted ? "1.5 3" : undefined}
          strokeOpacity={dotted ? 0.6 : 1}
        />
      </svg>
      {label}
    </span>
  );
}

/** Barras agrupadas: período atual × comparação (ou duas medidas). */
export function GroupedBars({
  labels,
  a,
  b,
  aLabel,
  bLabel,
  aColor = BI.blue,
  bColor = "#CBD5E1",
  ariaLabel,
}: {
  labels: string[];
  a: number[];
  b: number[];
  aLabel: string;
  bLabel: string;
  aColor?: string;
  bColor?: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...a, ...b);
  if (a.every((v) => v === 0) && b.every((v) => v === 0)) return <Empty title="Sem registros no período" />;
  const step = Math.ceil(labels.length / 8);
  return (
    <div>
      <div className="mb-2 flex gap-4 text-[11px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm" style={{ background: aColor }} /> {aLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-sm" style={{ background: bColor }} /> {bLabel}
        </span>
      </div>
      <div
        className="relative flex h-44 items-end gap-1"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {labels.map((l, i) => (
          <div
            key={i}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            onMouseEnter={() => setHover(i)}
          >
            <div className="flex h-full items-end justify-center gap-[2px]">
              <div
                className="w-1/2 max-w-4 rounded-t transition-all"
                style={{ height: `${(b[i]! / max) * 100}%`, background: bColor, minHeight: b[i] ? 2 : 0 }}
              />
              <div
                className="w-1/2 max-w-4 rounded-t transition-all"
                style={{
                  height: `${(a[i]! / max) * 100}%`,
                  background: aColor,
                  minHeight: a[i] ? 2 : 0,
                  opacity: hover === null || hover === i ? 1 : 0.55,
                }}
              />
            </div>
            <div className="mt-1 h-3 truncate text-center text-[10px] text-ink-soft">
              {i % step === 0 ? l : ""}
            </div>
          </div>
        ))}
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
            <div className="font-medium">{labels[hover]}</div>
            <div className="tabular-nums" style={{ color: aColor === "#CBD5E1" ? undefined : aColor }}>
              {aLabel}: {a[hover]}
            </div>
            <div className="tabular-nums text-ink-soft">
              {bLabel}: {b[hover]}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Rosca com quantidades e percentuais; fatias clicáveis (drill-down). */
export function Donut({
  items,
  centerLabel,
  onSelect,
  stacked = false,
}: {
  /** Gráfico em cima e legenda embaixo (cards estreitos). */
  stacked?: boolean;
  items: { key: string; label: string; value: number; color: string }[];
  centerLabel: string;
  onSelect?: (key: string) => void;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return <Empty title="Sem clientes no filtro" />;
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className={`flex flex-col items-center gap-5 ${stacked ? "" : "sm:flex-row"}`}>
      <svg
        viewBox="0 0 140 140"
        className="h-40 w-40 shrink-0 -rotate-90"
        role="img"
        aria-label="Distribuição da carteira"
      >
        <circle cx="70" cy="70" r={R} fill="none" stroke="#EEF1F6" strokeWidth="16" />
        {items.map((it) => {
          const len = (it.value / total) * C;
          const el = it.value ? (
            <circle
              key={it.key}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={it.color}
              strokeWidth="16"
              strokeDasharray={`${Math.max(len - 2, 0.1)} ${C}`}
              strokeDashoffset={-acc}
              className={onSelect ? "cursor-pointer transition-opacity hover:opacity-80" : ""}
              onClick={() => onSelect?.(it.key)}
            >
              <title>{`${it.label}: ${it.value}`}</title>
            </circle>
          ) : null;
          acc += len;
          return el;
        })}
        <text
          x="70"
          y="66"
          textAnchor="middle"
          transform="rotate(90 70 70)"
          className="fill-ink text-[22px] font-semibold tabular-nums"
        >
          {total}
        </text>
        <text
          x="70"
          y="84"
          textAnchor="middle"
          transform="rotate(90 70 70)"
          className="fill-ink-soft text-[9px]"
        >
          {centerLabel}
        </text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {items.map((it) => (
          <li key={it.key}>
            <button
              type="button"
              disabled={!onSelect || !it.value}
              onClick={() => onSelect?.(it.key)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition enabled:hover:bg-canvas"
            >
              <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
              <span className="flex-1">{it.label}</span>
              <span className="font-semibold tabular-nums">{it.value}</span>
              <span className="w-10 text-right text-xs tabular-nums text-ink-soft">
                {fmtShare(it.value / total)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras horizontais com valor e percentual. */
export function HBars({
  items,
  color = BI.blue,
  onSelect,
}: {
  items: { key: string; label: ReactNode; value: number; note?: ReactNode; color?: string }[];
  color?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.key}>
          <div
            className={`rounded-lg ${onSelect ? "cursor-pointer px-1 py-0.5 transition hover:bg-canvas" : ""}`}
            onClick={() => onSelect?.(it.key)}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{it.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">{it.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#EEF1F6]">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max((it.value / max) * 100, it.value ? 3 : 0)}%`,
                  background: it.color ?? color,
                }}
              />
            </div>
            {it.note && <div className="mt-1 text-[11px] text-ink-soft">{it.note}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Número com rótulo (cards internos das seções). */
export function Stat({
  label,
  value,
  hint,
  tone,
  tip,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  tip?: string;
}) {
  return (
    <div className="rounded-xl border border-line/70 bg-white/70 p-3.5 text-center">
      <div className="flex items-center justify-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
        {label} {tip && <Tip text={tip} />}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-soft">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/70 ${className}`} />;
}
