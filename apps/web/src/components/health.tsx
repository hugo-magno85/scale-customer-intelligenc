"use client";

import type { HealthClass, IndicatorResult } from "@sci/contracts";
import { INDICATOR_LABELS } from "@sci/contracts";
import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useState } from "react";

const CLASS: Record<HealthClass, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  healthy: { label: "Saudável", cls: "bg-healthy/10 text-healthy", Icon: CheckCircle2 },
  attention: { label: "Atenção", cls: "bg-attention/10 text-attention", Icon: AlertTriangle },
  high_risk: { label: "Risco alto", cls: "bg-risk/10 text-risk", Icon: AlertOctagon },
};

/** Status sempre com ícone + texto (nunca só cor). */
export function HealthBadge({ value }: { value: HealthClass | null }) {
  if (!value) return <span className="text-xs text-ink-soft">Sem dados suficientes</span>;
  const c = CLASS[value];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}>
      <c.Icon size={12} aria-hidden /> {c.label}
    </span>
  );
}

const SEV: Record<string, { label: string; cls: string }> = {
  critical: { label: "Crítico", cls: "bg-risk text-white" },
  high: { label: "Alto", cls: "bg-risk/10 text-risk" },
  medium: { label: "Médio", cls: "bg-attention/10 text-attention" },
  low: { label: "Baixo", cls: "bg-canvas text-ink-soft border border-line" },
};
export function SeverityBadge({ value }: { value: string }) {
  const s = SEV[value] ?? SEV.low!;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  );
}

/** Barra de nota 0–100 (magnitude, um único tom) com valor em texto. */
export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-ink-soft">Sem evidência</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      <span className="w-8 text-right text-sm tabular-nums">{Math.round(score)}</span>
    </div>
  );
}

export function IndicatorTable({ indicators }: { indicators: IndicatorResult[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-line">
      {indicators.map((i) => (
        <div key={i.indicator} className="py-2.5">
          <button
            className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
            onClick={() => setOpen(open === i.indicator ? null : i.indicator)}
            aria-expanded={open === i.indicator}
          >
            <span className="text-sm font-medium">{INDICATOR_LABELS[i.indicator]}</span>
            <span className="flex items-center gap-3">
              {i.confidence !== null && (
                <span className="text-xs text-ink-soft">confiança {Math.round(i.confidence * 100)}%</span>
              )}
              <ScoreBar score={i.score} />
            </span>
          </button>
          {open === i.indicator && (
            <div className="mt-2 space-y-1.5 text-sm">
              <p className="text-ink-soft">{i.rationale}</p>
              {i.evidence.map((e) => (
                <blockquote key={e.segmentId} className="border-l-2 border-brand/40 pl-3 text-ink-soft">
                  “{e.text}” <span className="text-xs">· {e.speaker === "customer" ? "cliente" : "CS"}</span>
                </blockquote>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Evolução do Customer Health: uma série, escala 0–100, crosshair + tooltip. */
export function HealthLine({ points }: { points: { date: string; score: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2)
    return <p className="text-sm text-ink-soft">A evolução aparece a partir da segunda análise.</p>;
  const W = 560;
  const H = 160;
  const pad = { l: 32, r: 12, t: 10, b: 22 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number) => pad.t + ((100 - v) * (H - pad.t - pad.b)) / 100;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ");
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Evolução do Customer Health"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(
            Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1)),
              ),
            ),
          );
        }}
      >
        {[0, 40, 70, 100].map((g) => (
          <g key={g}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(g)}
              y2={y(g)}
              stroke="currentColor"
              className="text-line"
              strokeWidth={1}
            />
            <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" className="fill-ink-soft text-[10px]">
              {g}
            </text>
          </g>
        ))}
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          className="text-brand"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.score)}
            r={4}
            className="fill-brand stroke-white"
            strokeWidth={2}
          />
        ))}
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
          <div className="font-semibold tabular-nums">{Math.round(h.score)}</div>
          <div className="text-ink-soft">{new Date(h.date).toLocaleDateString("pt-BR")}</div>
        </div>
      )}
    </div>
  );
}
