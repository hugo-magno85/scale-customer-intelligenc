"use client";

import {
  INDICATOR_LABELS,
  type BiComparison,
  type BiCustomer,
  type BiKpi,
  type BiKpiKey,
  type Indicator,
  type ReportBi,
} from "@sci/contracts";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  HeartPulse,
  ListChecks,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
  Video,
  X,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AreaCompare,
  BI,
  bandOf,
  Delta,
  Donut,
  Empty,
  fmt1,
  fmtDate,
  fmtPct,
  fmtShare,
  GroupedBars,
  HBars,
  Panel,
  SectionTitle,
  Skeleton,
  Sparkline,
  Stat,
  Tip,
  toTen,
} from "@/components/bi";
import {
  activeFilterCount,
  BiFilterBar,
  biQuery,
  DEFAULT_BI,
  type BiState,
  type Preset,
} from "@/components/bi-filters";
import { HealthBadge, SeverityBadge } from "@/components/health";
import { formatBRL } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/* ---------------------------------------------------------------- KPIs -- */

/** Valor em reais curto para os cards (o valor exato aparece no detalhe). */
function compactBRL(cents: number): string {
  const r = cents / 100;
  if (Math.abs(r) < 10_000) return formatBRL(Math.round(r) * 100).replace(/,00$/, "");
  const [n, unit] = Math.abs(r) >= 1_000_000 ? [r / 1_000_000, "mi"] : [r / 1_000, "mil"];
  return `R$ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${unit}`;
}

const KPI_META: Record<
  BiKpiKey,
  {
    label: string;
    Icon: typeof Users;
    color: string;
    format: (v: number) => string;
    drill?: string;
    href?: string;
  }
> = {
  active_customers: { label: "Clientes ativos", Icon: Users, color: BI.blue, format: String, drill: "all" },
  average_health: {
    label: "Customer Health médio",
    Icon: HeartPulse,
    color: BI.blue,
    format: (v) => fmt1(v / 10),
    drill: "with_health",
  },
  healthy: {
    label: "Clientes saudáveis",
    Icon: CheckCircle2,
    color: BI.green,
    format: String,
    drill: "healthy",
  },
  attention: {
    label: "Clientes em atenção",
    Icon: AlertTriangle,
    color: BI.orange,
    format: String,
    drill: "attention",
  },
  high_risk: {
    label: "Clientes em risco alto",
    Icon: AlertOctagon,
    color: BI.red,
    format: String,
    drill: "high_risk",
  },
  revenue_at_risk: {
    label: "Receita em risco",
    Icon: CircleDollarSign,
    color: BI.red,
    format: (v) => compactBRL(v),
    drill: "revenue",
  },
  expansion: {
    label: "Oportunidades de expansão",
    Icon: TrendingUp,
    color: BI.green,
    format: String,
    drill: "expansion",
  },
  analyzed_meetings: {
    label: "Reuniões analisadas",
    Icon: Video,
    color: BI.blue,
    format: String,
    href: "/app/calls",
  },
  pending_tasks: {
    label: "Tarefas pendentes",
    Icon: ListChecks,
    color: BI.blue,
    format: String,
    drill: "pending",
  },
  overdue_tasks: { label: "Tarefas atrasadas", Icon: Clock, color: BI.red, format: String, drill: "overdue" },
};

const SHARE_LABEL: Partial<Record<BiKpiKey, string>> = {
  healthy: "dos clientes avaliados",
  attention: "dos clientes avaliados",
  high_risk: "dos clientes avaliados",
  expansion: "da carteira com potencial",
  overdue_tasks: "das pendentes",
};

/* ----------------------------------------------------------- drill-down -- */

const DRILLS: Record<string, { title: string; match: (c: BiCustomer) => boolean }> = {
  all: { title: "Clientes ativos", match: () => true },
  with_health: { title: "Clientes com Customer Health", match: (c) => c.healthScore !== null },
  healthy: { title: "Clientes saudáveis", match: (c) => c.healthClass === "healthy" },
  attention: { title: "Clientes em atenção", match: (c) => c.healthClass === "attention" },
  high_risk: { title: "Clientes em risco alto", match: (c) => c.healthClass === "high_risk" },
  no_data: { title: "Clientes sem nota", match: (c) => c.healthScore === null },
  revenue: { title: "Clientes com sinal de risco aberto", match: (c) => c.openRisks > 0 },
  expansion: { title: "Clientes com oportunidade aberta", match: (c) => c.openOpportunities > 0 },
  pending: { title: "Clientes com ações pendentes", match: (c) => c.pendingTasks > 0 },
  overdue: { title: "Clientes com ações atrasadas", match: (c) => c.overdueTasks > 0 },
};

function DrillPanel({
  drill,
  customers,
  onClose,
}: {
  drill: string;
  customers: BiCustomer[];
  onClose: () => void;
}) {
  const d = DRILLS[drill]!;
  const rows = customers.filter(d.match);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Sem retorno: em navegadores recentes scrollIntoView devolve uma Promise, que o React trataria como cleanup
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [drill]);
  return (
    <div ref={ref} className="mt-6 scroll-mt-24">
      <Panel
        title={`${d.title} (${rows.length})`}
        subtitle="Situação atual de cada cliente. Clique para abrir a ficha com o histórico do Customer Health."
        actions={
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-canvas hover:text-ink"
            aria-label="Fechar detalhamento"
          >
            <X size={16} />
          </button>
        }
      >
        {rows.length === 0 ? <Empty title="Nenhum cliente nesta visão" /> : <CustomerTable rows={rows} />}
      </Panel>
    </div>
  );
}

function CustomerTable({ rows }: { rows: BiCustomer[] }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="border-y border-line text-left text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="px-5 py-2.5 font-medium">Cliente</th>
            <th className="px-3 py-2.5 font-medium">Health</th>
            <th className="px-3 py-2.5 font-medium">Classificação</th>
            <th className="px-3 py-2.5 font-medium">Maior risco</th>
            <th className="px-3 py-2.5 font-medium">Receita em risco</th>
            <th className="px-3 py-2.5 font-medium">Oport.</th>
            <th className="px-3 py-2.5 font-medium">Ações pend.</th>
            <th className="px-3 py-2.5 font-medium">Última análise</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-canvas/60">
              <td className="px-5 py-2.5">
                <Link href={`/app/carteira/${c.id}`} className="font-medium hover:text-bi-blue">
                  {c.name}
                </Link>
                <div className="text-xs text-ink-soft">
                  {[c.segment, c.ownerName].filter(Boolean).join(" · ") || "—"}
                </div>
              </td>
              <td className="px-3 py-2.5 font-semibold tabular-nums">
                {c.healthScore === null ? "—" : fmt1(c.healthScore / 10)}
              </td>
              <td className="px-3 py-2.5">
                <HealthBadge value={c.healthClass} />
              </td>
              <td className="px-3 py-2.5">
                {c.maxSeverity ? (
                  <div className="flex flex-col gap-0.5">
                    <SeverityBadge value={c.maxSeverity} />
                    <span className="text-xs text-ink-soft">{c.mainFactor}</span>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5 tabular-nums">
                {c.openRisks ? (
                  c.revenueAtRiskCents === null ? (
                    <span className="text-xs text-ink-soft">não informada</span>
                  ) : (
                    formatBRL(c.revenueAtRiskCents)
                  )
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5 tabular-nums">{c.openOpportunities || "—"}</td>
              <td className="px-3 py-2.5 tabular-nums">
                {c.pendingTasks || "—"}
                {c.overdueTasks > 0 && (
                  <span className="ml-1 text-xs text-bi-red">({c.overdueTasks} atras.)</span>
                )}
              </td>
              <td className="px-3 py-2.5 tabular-nums text-ink-soft">{fmtDate(c.lastAnalysisAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- seções -- */

const localCmp = (cur: number | null, prev: number | null): BiComparison =>
  cur === null || prev === null
    ? { previous: null, delta: null, deltaPct: null, status: "no_history", note: null }
    : {
        previous: prev,
        delta: Math.round((cur - prev) * 10) / 10,
        deltaPct: prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null,
        status: "ok",
        note: null,
      };

function IndicatorCards({ data }: { data: ReportBi }) {
  if (!data.indicators.length)
    return (
      <Empty title="Sem indicadores no período">
        Os indicadores aparecem quando as reuniões analisadas têm falas do cliente que os sustentem.
      </Empty>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {data.indicators.map((i) => {
        const inverted = i.indicator === "churn_risk";
        const b = bandOf(i.average === null ? null : inverted ? 100 - i.average : i.average, data.bands);
        const label = inverted
          ? b.label === "Crítico"
            ? "Risco elevado"
            : b.label === "Atenção"
              ? "Risco moderado"
              : "Risco baixo"
          : b.label;
        return (
          <div
            key={i.indicator}
            className="bi-rise rounded-2xl border border-white/70 bg-white/85 p-4 shadow-[0_1px_2px_rgba(15,23,41,0.04)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium">
                {INDICATOR_LABELS[i.indicator as Indicator] ?? i.indicator}
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: `${b.color}18`, color: b.color }}
              >
                {i.average === null ? "Sem dados" : label}
              </span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  {i.average === null ? "—" : fmt1(i.average / 10)}
                </div>
                <div className="text-[11px] text-ink-soft">
                  {i.samples} reuniões · anterior{" "}
                  {i.previous === null ? "sem histórico" : fmt1(i.previous / 10)}
                </div>
              </div>
              <Delta
                comparison={localCmp(i.average, i.previous)}
                direction={inverted ? "down_is_good" : "up_is_good"}
              />
            </div>
            <div className="mt-2">
              <Sparkline values={i.series} color={b.color} />
            </div>
            {inverted && <div className="mt-1 text-[10px] text-ink-soft">Quanto maior, pior.</div>}
          </div>
        );
      })}
    </div>
  );
}

const OPP_STATUS: Record<string, string> = { open: "Aberta", qualified: "Em acompanhamento" };

/* --------------------------------------------------- visual do dashboard -- */

/** Cores de cada indicador no visual claro e vibrante (fundo em gradiente suave). */
const VIVID: Partial<Record<BiKpiKey, { color: string; ink: string; bg: string; ring: string }>> = {
  active_customers: {
    color: "#2B47FF",
    ink: "#1A2A8F",
    bg: "linear-gradient(145deg,#F3F5FF,#E2E8FF)",
    ring: "#D6DDFF",
  },
  attention: {
    color: "#F08A00",
    ink: "#6E3900",
    bg: "linear-gradient(145deg,#FFF7EE,#FFE3C4)",
    ring: "#FFDDB8",
  },
  revenue_at_risk: {
    color: "#E5324F",
    ink: "#8C1027",
    bg: "linear-gradient(145deg,#FFF3F5,#FFDDE3)",
    ring: "#FFD0D8",
  },
  expansion: {
    color: "#00A957",
    ink: "#00562C",
    bg: "linear-gradient(145deg,#F0FCF5,#D4F5E3)",
    ring: "#C3EFD7",
  },
  analyzed_meetings: {
    color: "#7C4DFF",
    ink: "#3E1FA8",
    bg: "linear-gradient(145deg,#F7F3FF,#E9E0FF)",
    ring: "#E0D4FF",
  },
  pending_tasks: {
    color: "#E09B00",
    ink: "#6B4700",
    bg: "linear-gradient(145deg,#FFFBEB,#FFEFB8)",
    ring: "#FFE79A",
  },
  overdue_tasks: {
    color: "#E5324F",
    ink: "#8C1027",
    bg: "linear-gradient(145deg,#FFF3F5,#FFDDE3)",
    ring: "#FFD0D8",
  },
};

const VIVID_LABEL: Partial<Record<BiKpiKey, string>> = {
  attention: "Clientes em atenção",
  expansion: "Oportunidades",
};

function VividCard({
  label,
  className = "",
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-[20px] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,64,.05),0_8px_24px_-12px_rgba(16,24,64,.14)] ${className}`}
    >
      <div className="mb-3 text-[13px] font-semibold text-[#4A5068]">{label}</div>
      {children}
    </section>
  );
}

/** Variação em selo branco sobre o fundo colorido do card. */
function VividDelta({ kpi, ink }: { kpi: BiKpi; ink: string }) {
  const c = kpi.comparison;
  if (c.status !== "ok" || c.delta === null)
    return (
      <span className="inline-flex rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-[#4A5068]">
        {kpi.share !== null && kpi.value !== null
          ? `${fmtShare(kpi.share)} ${SHARE_LABEL[kpi.key] ?? ""}`
          : c.status === "not_applicable"
            ? "sem comparativo"
            : "histórico insuficiente"}
      </span>
    );
  const good =
    c.delta === 0 || kpi.direction === "neutral"
      ? null
      : kpi.direction === "up_is_good"
        ? c.delta > 0
        : c.delta < 0;
  const text =
    c.deltaPct !== null ? fmtPct(c.deltaPct) : `${c.delta > 0 ? "+" : ""}${c.delta.toLocaleString("pt-BR")}`;
  return (
    <span
      className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-bold"
      style={{ color: good === null ? ink : good ? "#00703A" : "#B3122E" }}
    >
      {c.delta > 0 ? "↑ " : c.delta < 0 ? "↓ " : ""}
      {text}
    </span>
  );
}

function VividKpi({
  kpi,
  onDrill,
  compact,
}: {
  kpi: BiKpi;
  onDrill: (k: string) => void;
  compact?: boolean;
}) {
  const m = KPI_META[kpi.key];
  const v = VIVID[kpi.key] ?? { color: BI.blue, ink: "#111633", bg: "#FFFFFF", ring: "#E3E7F1" };
  const label = VIVID_LABEL[kpi.key] ?? m.label;
  const value = kpi.value === null ? "—" : m.format(kpi.value);
  const cls =
    "group block rounded-[20px] text-left no-underline transition hover:-translate-y-0.5 motion-reduce:transform-none";
  const style = {
    background: v.bg,
    boxShadow: `inset 0 0 0 1px ${v.ring}, 0 8px 24px -14px rgba(16,24,64,.16)`,
  };
  const icon = (
    <span
      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-white shadow-[0_1px_2px_rgba(16,24,64,.08)]"
      style={{ color: v.color }}
    >
      <m.Icon size={18} aria-hidden />
    </span>
  );
  // Número centralizado: cabeçalho em cima, valor + variação no meio, tendência embaixo
  const body = (
    <div className={`flex h-full flex-col gap-2 ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-xs font-bold" style={{ color: v.ink }}>
          {label}
        </span>
        <span className="ml-auto">
          <Tip text={kpi.source} />
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-1 text-center">
        <div
          className={`font-[Inter_Tight,Inter,sans-serif] font-bold leading-none tracking-[-0.03em] ${
            compact ? "text-[30px]" : value.length > 9 ? "text-[30px]" : "text-[42px]"
          }`}
          style={{ color: v.ink }}
        >
          {value}
        </div>
        <VividDelta kpi={kpi} ink={v.ink} />
      </div>
      <Sparkline values={kpi.spark} color={v.color} height={compact ? 22 : 30} />
    </div>
  );
  if (m.href)
    return (
      <Link href={m.href} className={cls} style={style}>
        {body}
      </Link>
    );
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${cls} cursor-pointer`}
      style={style}
      onClick={() => onDrill(m.drill!)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onDrill(m.drill!)}
    >
      {body}
    </div>
  );
}

function TasksDoneCard({ data }: { data: ReportBi }) {
  const p = data.plans;
  const ink = "#00562C";
  return (
    <Link
      href="/app/planos"
      className="flex flex-col gap-2 rounded-[20px] p-4 no-underline transition hover:-translate-y-0.5 motion-reduce:transform-none"
      style={{
        background: "linear-gradient(145deg,#F0FCF5,#D4F5E3)",
        boxShadow: "inset 0 0 0 1px #C3EFD7, 0 8px 24px -14px rgba(16,24,64,.16)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-white text-[#00A957] shadow-[0_1px_2px_rgba(16,24,64,.08)]">
          <CheckCircle2 size={18} aria-hidden />
        </span>
        <span className="text-xs font-bold" style={{ color: ink }}>
          Tarefas concluídas
        </span>
        <span className="ml-auto">
          <Tip text="Das tarefas criadas no período (sem as canceladas), quantas já foram concluídas. Tempo médio: da criação à conclusão." />
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-1 text-center">
        <span
          className="font-[Inter_Tight,Inter,sans-serif] text-[30px] font-bold leading-none tracking-[-0.03em]"
          style={{ color: ink }}
        >
          {p.completionRate === null ? "—" : `${p.completionRate.toLocaleString("pt-BR")}%`}
        </span>
        <span
          className="inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-bold"
          style={{ color: ink }}
        >
          {p.completionRate === null
            ? "nenhuma tarefa no período"
            : `${p.completed} de ${p.created}${p.avgCompletionDays !== null ? ` · ${p.avgCompletionDays.toLocaleString("pt-BR")} dias` : ""}`}
        </span>
      </div>
      <div className="h-[22px]" aria-hidden />
    </Link>
  );
}

/** Customer Health compacto: velocímetro sobre o card azul da marca. */
function HealthCompact({ data }: { data: ReportBi }) {
  const g = data.gauge;
  const band = bandOf(g.score, data.bands);
  const v = g.score === null ? null : Math.max(0, Math.min(100, g.score));
  const pt = (x: number) => {
    const a = Math.PI * (1 - x / 100);
    return [150 + 120 * Math.cos(a), 150 - 120 * Math.sin(a)] as const;
  };
  const end = v === null ? null : pt(Math.max(v, 0.5));
  const Mini = ({ label, val, pct }: { label: string; val: number | null; pct: number | null }) => (
    <div className="rounded-xl bg-white/15 px-2.5 py-2">
      <div className="text-[11px] text-white/80">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-[Inter_Tight,Inter,sans-serif] text-base font-bold">
          {val === null ? "—" : fmt1(val / 10)}
        </span>
        {pct !== null && <span className="text-[11px] font-bold text-[#FFD2C2]">{fmtPct(pct)}</span>}
      </div>
    </div>
  );
  return (
    <section
      aria-label="Customer Health Score"
      className="flex min-w-[220px] flex-[0_1_250px] flex-col justify-between rounded-[20px] p-[18px] text-white shadow-[0_8px_24px_-12px_rgba(16,24,64,.3)]"
      style={{ background: "linear-gradient(160deg,#2B47FF 0%,#1E36D9 55%,#0FA968 130%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-xs font-semibold text-white/85">Customer Health</span>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
          {g.score === null ? "Sem dados" : band.label}
        </span>
      </div>
      <svg
        viewBox="0 0 300 170"
        className="mx-auto mt-1.5 block w-full max-w-[190px]"
        role="img"
        aria-label={`Customer Health ${v === null ? "sem dados" : fmt1(v / 10)} de 10`}
      >
        <defs>
          <linearGradient id="hc-g" x1="0" x2="1">
            <stop offset="0" stopColor="#FFB547" />
            <stop offset="1" stopColor="#5CF2A6" />
          </linearGradient>
        </defs>
        <path
          d="M30,150 A120,120 0 0 1 270,150"
          fill="none"
          stroke="rgba(255,255,255,.18)"
          strokeWidth={20}
          strokeLinecap="round"
        />
        {end && (
          <>
            <path
              d={`M30,150 A120,120 0 0 1 ${end[0]},${end[1]}`}
              fill="none"
              stroke="url(#hc-g)"
              strokeWidth={20}
              strokeLinecap="round"
            />
            <circle cx={end[0]} cy={end[1]} r={12} fill="#FFFFFF" />
          </>
        )}
        <text
          x="150"
          y="132"
          textAnchor="middle"
          fill="#FFFFFF"
          fontFamily="Inter Tight, Inter, sans-serif"
          fontWeight={700}
          fontSize={64}
          letterSpacing={-2}
        >
          {v === null ? "—" : fmt1(v / 10)}
        </text>
        <text
          x="150"
          y="158"
          textAnchor="middle"
          fill="rgba(255,255,255,.8)"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize={13}
        >
          de 10
        </text>
      </svg>
      <div className="text-center text-[11px] text-white/75">
        {g.customersWithHealth} de {g.activeCustomers} clientes com nota
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <Mini label="Mês anterior" val={g.previousMonth} pct={g.monthDeltaPct} />
        <Mini label="Ano anterior" val={g.previousYear} pct={g.yearDeltaPct} />
      </div>
    </section>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function TopRisk({ data }: { data: ReportBi }) {
  const byId = new Map(data.customers.map((c) => [c.id, c]));
  const rows = data.churn.priority.slice(0, 5);
  const chip = (sev: string | null, cls: string | null) =>
    sev === "critical"
      ? { bg: "#F0445E", fg: "#FFFFFF", text: "Crítico" }
      : sev === "high" || cls === "high_risk"
        ? { bg: "#FFE4E8", fg: "#B3122E", text: "Alto" }
        : { bg: "#FFF1DC", fg: "#8A4B00", text: "Atenção" };
  return (
    <section
      className="rounded-[20px] p-5 shadow-[0_1px_2px_rgba(16,24,64,.05),0_8px_24px_-12px_rgba(16,24,64,.14)]"
      style={{ background: "linear-gradient(180deg,#FFF6F7 0%,#FFFFFF 120px)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#FFE4E8] text-[#E5324F]">
            <AlertTriangle size={16} aria-hidden />
          </span>
          <span className="text-[15px] font-bold text-[#8C1027]">Top 5 em risco</span>
        </span>
        <Link href="/app/churn" className="text-[13px] font-semibold text-[#2B47FF] hover:underline">
          Churn Radar →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="mt-4">
          <Empty title="Nenhum cliente em risco agora" />
        </div>
      ) : (
        <ol className="mt-3.5 space-y-1.5">
          {rows.map((p, i) => {
            const c = chip(p.maxSeverity, p.healthClass);
            const rev = byId.get(p.id)?.revenueAtRiskCents ?? null;
            return (
              <li key={p.id}>
                <Link
                  href={`/app/carteira/${p.id}`}
                  className="flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 no-underline shadow-[inset_0_0_0_1px_#F3E3E6] hover:shadow-[inset_0_0_0_1px_#F0445E]"
                >
                  <span className="w-4 font-[Inter_Tight,Inter,sans-serif] text-[13px] font-bold text-[#B3122E]">
                    {i + 1}
                  </span>
                  <span
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold text-white"
                    style={{
                      background:
                        i < 2
                          ? "linear-gradient(135deg,#F0445E,#FF8A5C)"
                          : "linear-gradient(135deg,#FF8A5C,#FFA826)",
                    }}
                  >
                    {initials(p.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-[#111633]">{p.name}</div>
                    <div className="truncate text-xs text-[#4A5068]">
                      {p.mainFactor ?? p.nextAction ?? "—"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: c.bg, color: c.fg }}
                    >
                      {p.healthScore === null ? "" : `${fmt1(p.healthScore / 10)} · `}
                      {c.text}
                    </span>
                    <span className="text-xs font-semibold text-[#8C1027]">
                      {rev === null ? "sem valor informado" : `${formatBRL(rev)}/mês`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TopOpportunities({ data }: { data: ReportBi }) {
  const rows = data.expansion.ranking.slice(0, 5);
  return (
    <section
      className="rounded-[20px] p-5 shadow-[0_1px_2px_rgba(16,24,64,.05),0_8px_24px_-12px_rgba(16,24,64,.14)]"
      style={{ background: "linear-gradient(180deg,#F2FCF6 0%,#FFFFFF 120px)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-[#D4F5E3] text-[#00A957]">
            <TrendingUp size={16} aria-hidden />
          </span>
          <span className="text-[15px] font-bold text-[#00562C]">Top 5 oportunidades</span>
        </span>
        <span className="rounded-full bg-[#D4F5E3] px-2.5 py-0.5 text-xs font-bold text-[#00562C]">
          {data.expansion.potentialCents === null
            ? `${data.expansion.identified} no período`
            : `${formatBRL(data.expansion.potentialCents)} potencial`}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="mt-4">
          <Empty title="Nenhuma oportunidade aberta" />
        </div>
      ) : (
        <ol className="mt-3.5 space-y-1.5">
          {rows.map((o, i) => (
            <li key={o.id}>
              <Link
                href={`/app/carteira/${o.customerId}`}
                className="flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 no-underline shadow-[inset_0_0_0_1px_#DDEFE4] hover:shadow-[inset_0_0_0_1px_#00BF63]"
              >
                <span className="w-4 font-[Inter_Tight,Inter,sans-serif] text-[13px] font-bold text-[#00703A]">
                  {i + 1}
                </span>
                <span
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg,#00BF63,#2B47FF)" }}
                >
                  {initials(o.customerName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-[#111633]">{o.customerName}</div>
                  <div className="truncate text-xs text-[#4A5068]">
                    {o.type}: {o.need}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="font-[Inter_Tight,Inter,sans-serif] text-[15px] font-bold text-[#00562C]">
                    {o.potentialCents === null ? "a definir" : formatBRL(o.potentialCents)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${o.status === "qualified" ? "bg-[#E8ECFF] text-[#1E36D9]" : "bg-[#D4F5E3] text-[#00562C]"}`}
                  >
                    {OPP_STATUS[o.status] ?? o.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- página -- */

export default function DashboardPage() {
  const [filters, setFilters] = useState<BiState>(DEFAULT_BI);
  const [drill, setDrill] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<ReportBi>(`/reports/bi?${biQuery(filters)}`);
  const labels = useMemo(() => data?.buckets.map((b) => b.label) ?? [], [data]);
  const kpi = (k: BiKpiKey) => data?.kpis.find((x) => x.key === k);
  const cmpLabel = filters.compare === "year" ? "Ano anterior" : "Período anterior";
  const gran = data?.period.granularity === "month" ? "mês" : "semana";

  const [showFilters, setShowFilters] = useState(false);
  const nFilters = activeFilterCount(filters);
  const setPreset = (preset: Preset) => {
    setFilters({ ...filters, preset });
    setDrill(null);
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-[18px]">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-[Inter_Tight,Inter,sans-serif] text-[28px] font-bold tracking-[-0.03em] text-[#111633]">
            Dashboard Executivo
          </h1>
          <p className="mt-1 text-sm text-[#4A5068]">
            {data
              ? `${fmtDate(data.period.from)} a ${fmtDate(data.period.to)} · comparado com ${fmtDate(data.period.compareFrom)} a ${fmtDate(data.period.compareTo)}`
              : "Visão da carteira com dados reais das reuniões analisadas."}
            {loading && data && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs">
                <RefreshCw size={12} className="animate-spin" aria-hidden /> atualizando
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div role="group" aria-label="Período" className="flex gap-0.5 rounded-full bg-[#E3E7F1] p-[3px]">
            {(
              [
                ["last_30", "30 dias"],
                ["last_90", "90 dias"],
                ["last_365", "12 meses"],
                ["custom", "Personalizado"],
              ] as const
            ).map(([key, label]) => {
              const on =
                key === "custom"
                  ? !["last_30", "last_90", "last_365"].includes(filters.preset)
                  : filters.preset === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => (key === "custom" ? setShowFilters(true) : setPreset(key))}
                  className={`h-[34px] rounded-full px-3.5 text-[13px] font-semibold transition ${on ? "bg-white text-[#111633] shadow-[0_1px_3px_rgba(16,24,64,.12)]" : "text-[#4A5068] hover:text-[#111633]"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#D5DAE8] bg-white px-4 text-[13px] font-semibold text-[#111633] hover:border-[#2B47FF]"
          >
            <SlidersHorizontal size={16} aria-hidden /> Filtros
            {nFilters > 0 && (
              <span className="rounded-full bg-[#2B47FF] px-[7px] py-px text-[11px] text-white">
                {nFilters}
              </span>
            )}
          </button>
        </div>
      </div>
      {showFilters && (
        <BiFilterBar
          variant="panel"
          value={filters}
          onChange={(v) => {
            setFilters(v);
            setDrill(null);
          }}
        />
      )}

      {error && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-bi-red">Não foi possível carregar o dashboard</div>
              <div className="text-sm text-ink-soft">{error}</div>
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm hover:bg-canvas"
            >
              <RefreshCw size={14} aria-hidden /> Tentar novamente
            </button>
          </div>
        </Panel>
      )}

      {!data && !error && (
        <div className="grid gap-[18px] lg:grid-cols-12">
          <Skeleton className="h-64 lg:col-span-3" />
          <Skeleton className="h-64 lg:col-span-9" />
          <Skeleton className="h-28 lg:col-span-12" />
          <Skeleton className="h-72 lg:col-span-12" />
        </div>
      )}

      {data && (
        <div className={`space-y-[18px] ${loading ? "opacity-70 transition-opacity" : "transition-opacity"}`}>
          {/* Carteira: Health + 4 indicadores */}
          <div className="flex flex-wrap gap-[18px]">
            <HealthCompact data={data} />
            <div className="grid min-w-0 flex-[999_1_620px] grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[18px]">
              {(["active_customers", "attention", "revenue_at_risk", "expansion"] as const).map((key) =>
                kpi(key) ? <VividKpi key={key} kpi={kpi(key)!} onDrill={setDrill} /> : null,
              )}
            </div>
          </div>

          {/* Execução */}
          <section aria-label="Execução" className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] font-bold uppercase tracking-[.08em] text-[#4A5068]">
                Execução
              </span>
              <span className="h-px flex-1 bg-[#DCE1EE]" />
              <Link href="/app/planos" className="text-[13px] font-semibold text-[#2B47FF] hover:underline">
                Ver tarefas →
              </Link>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[18px]">
              {kpi("analyzed_meetings") && (
                <VividKpi kpi={kpi("analyzed_meetings")!} onDrill={setDrill} compact />
              )}
              <TasksDoneCard data={data} />
              {kpi("pending_tasks") && <VividKpi kpi={kpi("pending_tasks")!} onDrill={setDrill} compact />}
              {kpi("overdue_tasks") && <VividKpi kpi={kpi("overdue_tasks")!} onDrill={setDrill} compact />}
            </div>
          </section>

          {/* Evolução + distribuição */}
          <div className="flex flex-wrap gap-[18px]">
            <VividCard className="min-w-0 flex-[999_1_600px]" label="Evolução do Customer Health">
              <AreaCompare
                labels={labels}
                current={data.healthSeries.map((p) => toTen(p.value))}
                previous={data.healthSeries.map((p) => toTen(p.previous))}
                max={10}
                autoScale
                format={(v) => fmt1(v)}
                ariaLabel="Evolução do Customer Health"
                currentLabel="Período"
                previousLabel={cmpLabel}
              />
            </VividCard>
            <VividCard className="min-w-0 flex-[1_1_320px]" label="Distribuição da carteira">
              <Donut
                centerLabel="clientes"
                onSelect={setDrill}
                stacked
                items={[
                  { key: "healthy", label: "Saudáveis", value: data.distribution.healthy, color: "#00BF63" },
                  {
                    key: "attention",
                    label: "Em atenção",
                    value: data.distribution.attention,
                    color: "#FFA826",
                  },
                  {
                    key: "high_risk",
                    label: "Risco alto",
                    value: data.distribution.highRisk,
                    color: "#F0445E",
                  },
                  {
                    key: "no_data",
                    label: "Sem nota ainda",
                    value: data.distribution.noData,
                    color: "#C9CEDD",
                  },
                ]}
              />
            </VividCard>
          </div>

          {/* Top 5 + fatores */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-[18px]">
            <TopRisk data={data} />
            <TopOpportunities data={data} />
            <VividCard label="Fatores de risco abertos">
              {data.churn.factors.length === 0 ? (
                <Empty title="Nenhum sinal de risco aberto" />
              ) : (
                <ul className="mt-1 space-y-3">
                  {data.churn.factors.slice(0, 6).map((f, i) => {
                    const max = Math.max(...data.churn.factors.map((x) => x.customers), 1);
                    const fill = [
                      "#F0445E,#FF8A5C",
                      "#F0445E,#FF8A5C",
                      "#FF8A5C,#FFA826",
                      "#FF8A5C,#FFA826",
                      "#FFA826,#FFD166",
                      "#FFA826,#FFD166",
                    ][i];
                    return (
                      <li key={f.factorKey}>
                        <div className="flex justify-between gap-2 text-[13px] font-semibold">
                          <span className="truncate">{f.label}</span>
                          <span className="shrink-0 text-[#4A5068]">{f.customers} clientes</span>
                        </div>
                        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#EEF1F8]">
                          <div
                            className="h-2.5 rounded-full"
                            style={{
                              width: `${Math.max((f.customers / max) * 100, 4)}%`,
                              background: `linear-gradient(90deg,${fill})`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </VividCard>
          </div>

          {drill && <DrillPanel drill={drill} customers={data.customers} onClose={() => setDrill(null)} />}

          <details className="group rounded-[20px] bg-white/60 px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-[#111633]">
              Análise completa: movimentação de risco, receita, expansão, execução e indicadores das conversas
              <ChevronDown size={18} className="transition group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-2">
              {/* Evolução */}
              <SectionTitle>Análises temporais</SectionTitle>
              <div className="grid gap-4 lg:grid-cols-12">
                <Panel
                  className="lg:col-span-12"
                  title="Reuniões analisadas"
                  subtitle={`Por ${gran}, comparado com o ${cmpLabel.toLowerCase()}.`}
                >
                  <GroupedBars
                    labels={labels}
                    a={data.meetingsSeries.map((p) => p.value)}
                    b={data.meetingsSeries.map((p) => p.previous)}
                    aLabel="Período"
                    bLabel={cmpLabel}
                    ariaLabel="Reuniões analisadas por período"
                  />
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft">
                    <span>
                      Total no período: <b className="text-ink">{kpi("analyzed_meetings")?.value ?? 0}</b>
                    </span>
                    {kpi("analyzed_meetings") && (
                      <Delta comparison={kpi("analyzed_meetings")!.comparison} direction="up_is_good" />
                    )}
                  </div>
                </Panel>
                <Panel
                  className="lg:col-span-12"
                  title="Evolução do risco"
                  subtitle={`Mudança de classificação entre o início (${fmtDate(data.period.from)}) e o fim do período, para clientes com nota nas duas datas.`}
                >
                  {data.movement.comparable === 0 ? (
                    <Empty title="Histórico insuficiente">
                      Nenhum cliente tinha nota antes do início do período, então não dá para medir mudanças
                      de classificação.
                      {data.movement.withoutHistory > 0 &&
                        ` ${data.movement.withoutHistory} cliente(s) receberam a primeira nota no período.`}
                    </Empty>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      <Stat
                        label="Entraram em risco"
                        value={data.movement.entered}
                        tone={data.movement.entered ? BI.red : undefined}
                      />
                      <Stat
                        label="Permaneceram em risco"
                        value={data.movement.remained}
                        tone={data.movement.remained ? BI.orange : undefined}
                      />
                      <Stat
                        label="Recuperados"
                        value={data.movement.recovered}
                        tone={data.movement.recovered ? BI.green : undefined}
                        tip="Estavam em risco alto no início e saíram dessa faixa no fim do período."
                      />
                      <Stat label="Melhoraram a nota" value={data.movement.improved} tone={BI.green} />
                      <Stat
                        label="Pioraram a nota"
                        value={data.movement.worsened}
                        tone={data.movement.worsened ? BI.red : undefined}
                      />
                      <div className="text-[11px] text-ink-soft sm:col-span-3 lg:col-span-5">
                        Base: {data.movement.comparable} cliente(s) com nota no início e no fim.
                        {data.movement.withoutHistory > 0 &&
                          ` ${data.movement.withoutHistory} cliente(s) sem nota anterior ficaram fora da comparação.`}
                      </div>
                    </div>
                  )}
                </Panel>
              </div>

              {/* Churn */}
              <SectionTitle>Inteligência de churn</SectionTitle>
              <div className="grid gap-4 lg:grid-cols-12">
                <Panel
                  className="lg:col-span-7"
                  title="Principais fatores de risco abertos"
                  subtitle="Clientes impactados, participação na carteira e novos sinais no período."
                >
                  {data.churn.factors.length === 0 ? (
                    <Empty title="Nenhum sinal de risco aberto" />
                  ) : (
                    <HBars
                      color={BI.red}
                      items={data.churn.factors.map((f) => ({
                        key: f.factorKey,
                        label: (
                          <span>
                            {f.label}
                            {f.share !== null && (
                              <span className="ml-2 text-xs text-ink-soft">
                                {fmtShare(f.share)} da carteira
                              </span>
                            )}
                          </span>
                        ),
                        value: f.customers,
                        note: (
                          <span>
                            Novos no período: {f.newInPeriod} ({cmpLabel.toLowerCase()}: {f.newInComparison})
                            ·{" "}
                            {f.customerRefs.map((c, i) => (
                              <span key={c.id}>
                                {i > 0 && ", "}
                                <Link
                                  className="hover:text-bi-blue hover:underline"
                                  href={`/app/carteira/${c.id}`}
                                >
                                  {c.name}
                                </Link>
                              </span>
                            ))}
                            {f.customers > f.customerRefs.length && " …"}
                          </span>
                        ),
                      }))}
                    />
                  )}
                </Panel>
                <Panel
                  className="lg:col-span-5"
                  title="Receita em risco"
                  subtitle="Somente valores informados nos sinais ou na carteira — nada é estimado."
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Stat
                      label="Recorrente em risco"
                      value={
                        data.churn.revenue.atRiskCents === null
                          ? "—"
                          : formatBRL(data.churn.revenue.atRiskCents)
                      }
                      tone={BI.red}
                      hint={
                        data.churn.revenue.customersWithoutRevenue
                          ? `${data.churn.revenue.customersWithoutRevenue} cliente(s) sem valor informado`
                          : undefined
                      }
                    />
                    <Stat label="Clientes impactados" value={data.churn.revenue.impactedCustomers} />
                    <Stat
                      label="Receita recuperada"
                      value={
                        data.churn.revenue.recoveredCents === null
                          ? "—"
                          : formatBRL(data.churn.revenue.recoveredCents)
                      }
                      tone={BI.green}
                      hint={`${data.churn.revenue.recoveredCustomers} cliente(s) saíram do risco alto`}
                      tip="Receita mensal cadastrada dos clientes que estavam em risco alto no início do período e saíram dessa faixa no fim."
                    />
                    <div className="rounded-xl border border-line/70 bg-white/70 p-3.5">
                      <div className="text-center text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                        Nova receita em risco por {gran}
                      </div>
                      <div className="mt-2">
                        <Sparkline values={data.churn.revenue.series} color={BI.red} height={40} />
                      </div>
                    </div>
                  </div>
                </Panel>
                <Panel
                  className="lg:col-span-12"
                  title="Clientes prioritários"
                  subtitle="Risco alto, sinal crítico/alto aberto ou ação atrasada — ordenados por gravidade e nota."
                >
                  {data.churn.priority.length === 0 ? (
                    <Empty title="Nenhum cliente precisando de intervenção agora" />
                  ) : (
                    <div className="-mx-5 overflow-x-auto">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead className="border-y border-line text-left text-[11px] uppercase tracking-wide text-ink-soft">
                          <tr>
                            <th className="px-5 py-2.5 font-medium">Cliente</th>
                            <th className="px-3 py-2.5 font-medium">Health</th>
                            <th className="px-3 py-2.5 font-medium">Risco</th>
                            <th className="px-3 py-2.5 font-medium">Principal fator</th>
                            <th className="px-3 py-2.5 font-medium">Última análise</th>
                            <th className="px-3 py-2.5 font-medium">Plano de ação</th>
                            <th className="px-3 py-2.5 font-medium">Responsável</th>
                            <th className="px-3 py-2.5 font-medium">Próxima ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.churn.priority.map((p) => (
                            <tr
                              key={p.id}
                              className="border-b border-line/70 last:border-0 hover:bg-canvas/60"
                            >
                              <td className="px-5 py-2.5">
                                <Link
                                  href={`/app/carteira/${p.id}`}
                                  className="inline-flex items-center gap-1 font-medium hover:text-bi-blue"
                                >
                                  {p.name} <ArrowUpRight size={12} className="opacity-50" aria-hidden />
                                </Link>
                              </td>
                              <td className="px-3 py-2.5 font-semibold tabular-nums">
                                {p.healthScore === null ? "—" : fmt1(p.healthScore / 10)}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {p.healthClass && <HealthBadge value={p.healthClass} />}
                                  {p.maxSeverity && <SeverityBadge value={p.maxSeverity} />}
                                </div>
                              </td>
                              <td className="px-3 py-2.5">{p.mainFactor ?? "—"}</td>
                              <td className="px-3 py-2.5 tabular-nums text-ink-soft">
                                {fmtDate(p.lastAnalysisAt)}
                              </td>
                              <td className="px-3 py-2.5">
                                {p.planTitle ?? <span className="text-ink-soft">Sem plano</span>}
                                {p.openTasks > 0 && (
                                  <div className="text-xs text-ink-soft">
                                    {p.openTasks} ação(ões) aberta(s)
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                {p.ownerName ?? <span className="text-ink-soft">Sem responsável</span>}
                              </td>
                              <td className="max-w-64 px-3 py-2.5 text-ink-soft">{p.nextAction ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </div>

              {/* Expansão */}
              <SectionTitle hint="Potencial identificado não é receita contratada">
                Inteligência de expansão
              </SectionTitle>
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-12 xl:grid-cols-6">
                  <Stat
                    label="Identificadas no período"
                    value={data.expansion.identified}
                    hint={
                      <Delta
                        comparison={localCmp(data.expansion.identified, data.expansion.identifiedComparison)}
                        direction="up_is_good"
                      />
                    }
                  />
                  <Stat label="Clientes com potencial" value={data.expansion.customersWithPotential} />
                  <Stat
                    label="Em acompanhamento"
                    value={data.expansion.inFollowUp}
                    tip="Oportunidades qualificadas, em negociação."
                  />
                  <Stat
                    label="Potencial registrado"
                    value={
                      data.expansion.potentialCents === null ? "—" : formatBRL(data.expansion.potentialCents)
                    }
                    hint={
                      data.expansion.potentialCents === null
                        ? "nenhum valor informado"
                        : "informado por pessoas ou CRM"
                    }
                  />
                  <Stat
                    label="Convertidas no período"
                    value={data.expansion.converted}
                    tone={data.expansion.converted ? BI.green : undefined}
                    hint={
                      <Delta
                        comparison={localCmp(data.expansion.converted, data.expansion.convertedComparison)}
                        direction="up_is_good"
                      />
                    }
                  />
                  <Stat
                    label="Taxa de conversão"
                    value={
                      data.expansion.identified
                        ? fmtShare(data.expansion.converted / data.expansion.identified)
                        : "—"
                    }
                    tip="Convertidas ÷ identificadas no período."
                  />
                </div>
                <Panel
                  className="lg:col-span-5"
                  title="Evolução das oportunidades"
                  subtitle={`Identificadas × convertidas por ${gran}.`}
                >
                  <GroupedBars
                    labels={labels}
                    a={data.expansion.series.map((s) => s.identified)}
                    b={data.expansion.series.map((s) => s.converted)}
                    aLabel="Identificadas"
                    bLabel="Convertidas"
                    aColor={BI.green}
                    bColor={BI.blue}
                    ariaLabel="Oportunidades identificadas e convertidas"
                  />
                </Panel>
                <Panel
                  className="lg:col-span-7"
                  title="Ranking de oportunidades"
                  subtitle="Abertas e em acompanhamento, com a evidência da reunião."
                >
                  {data.expansion.ranking.length === 0 ? (
                    <Empty title="Nenhuma oportunidade aberta" />
                  ) : (
                    <ul className="divide-y divide-line/70">
                      {data.expansion.ranking.map((o) => (
                        <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <Link
                              href={`/app/carteira/${o.customerId}`}
                              className="font-medium hover:text-bi-blue"
                            >
                              {o.customerName}
                            </Link>
                            <span className="flex items-center gap-2 text-xs">
                              {o.potentialCents !== null && (
                                <b className="tabular-nums">{formatBRL(o.potentialCents)}</b>
                              )}
                              <span
                                className={`rounded-full px-2 py-0.5 font-medium ${o.status === "qualified" ? "bg-bi-blue/10 text-bi-blue" : "bg-bi-green/10 text-[#0f8a5a]"}`}
                              >
                                {OPP_STATUS[o.status] ?? o.status}
                              </span>
                            </span>
                          </div>
                          <div className="mt-0.5 text-sm">
                            <span className="text-ink-soft">{o.type}:</span> {o.need}
                          </div>
                          {o.evidence && (
                            <div className="mt-1 border-l-2 border-bi-green/40 pl-2 text-xs italic text-ink-soft">
                              “{o.evidence}”
                            </div>
                          )}
                          <div className="mt-1 text-xs text-ink-soft">
                            {o.ownerName ?? "Sem responsável"}
                            {o.nextAction && ` · Próxima ação: ${o.nextAction}`}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              {/* Planos */}
              <SectionTitle
                hint={
                  <Link href="/app/planos" className="hover:text-bi-blue">
                    Abrir planos de ação →
                  </Link>
                }
              >
                Desempenho dos planos de ação
              </SectionTitle>
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-5">
                  <Stat
                    label="Criadas"
                    value={data.plans.created}
                    hint={
                      <Delta
                        comparison={localCmp(data.plans.created, data.plans.createdComparison)}
                        direction="neutral"
                      />
                    }
                  />
                  <Stat
                    label="Concluídas"
                    value={data.plans.completed}
                    tone={data.plans.completed ? BI.green : undefined}
                    hint={
                      <Delta
                        comparison={localCmp(data.plans.completed, data.plans.completedComparison)}
                        direction="up_is_good"
                      />
                    }
                  />
                  <Stat label="Pendentes" value={data.plans.pending} hint="ao fim do período" />
                  <Stat
                    label="Atrasadas"
                    value={data.plans.overdue}
                    tone={data.plans.overdue ? BI.red : undefined}
                    hint="ao fim do período"
                  />
                  <Stat
                    label="Taxa de conclusão"
                    value={
                      data.plans.completionRate === null
                        ? "—"
                        : `${data.plans.completionRate.toLocaleString("pt-BR")}%`
                    }
                    tip="Das ações criadas no período (sem as canceladas), quantas já foram concluídas."
                    hint={
                      <Delta
                        comparison={localCmp(data.plans.completionRate, data.plans.completionRateComparison)}
                        direction="up_is_good"
                        unit="abs"
                      />
                    }
                  />
                  <Stat
                    label="Tempo médio"
                    value={
                      data.plans.avgCompletionDays === null
                        ? "—"
                        : `${data.plans.avgCompletionDays.toLocaleString("pt-BR")} d`
                    }
                    tip="Dias entre a criação e a conclusão das ações concluídas no período."
                    hint={
                      data.plans.avgCompletionDays === null ? "sem conclusões no período" : "para concluir"
                    }
                  />
                </div>
                <Panel
                  className="lg:col-span-7"
                  title="Execução dos planos"
                  subtitle={`Ações criadas × concluídas por ${gran}.`}
                >
                  <GroupedBars
                    labels={labels}
                    a={data.plans.series.map((s) => s.completed)}
                    b={data.plans.series.map((s) => s.created)}
                    aLabel="Concluídas"
                    bLabel="Criadas"
                    aColor={BI.green}
                    ariaLabel="Ações criadas e concluídas"
                  />
                </Panel>
              </div>

              {/* Indicadores */}
              <SectionTitle hint={`Escala 0 a 10 · comparado com o ${cmpLabel.toLowerCase()}`}>
                Média dos indicadores no período
              </SectionTitle>
              <IndicatorCards data={data} />

              <Integrity data={data} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function Integrity({ data }: { data: ReportBi }): ReactNode {
  const missing = data.kpis.filter((k) => k.comparison.status !== "ok");
  return (
    <div className="mt-10 rounded-2xl border border-line/70 bg-white/60 p-4 text-xs leading-relaxed text-ink-soft">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
        <Sparkles size={13} aria-hidden /> Sobre os dados
      </div>
      Todos os números vêm dos registros reais da carteira e das reuniões analisadas; “—” indica dado
      indisponível, nunca zero. Valores “ao fim do período” usam a última nota de Customer Health de cada
      cliente até a data.
      {missing.length > 0 && (
        <>
          {" "}
          Sem comparativo neste filtro:{" "}
          {missing
            .map(
              (k) =>
                `${KPI_META[k.key].label} (${k.comparison.note ?? (k.comparison.status === "no_history" ? "histórico insuficiente" : "não se aplica")})`,
            )
            .join("; ")}
          .
        </>
      )}{" "}
      Classificação da carteira: crítico abaixo de {fmt1(data.bands.attentionMin / 10)}, atenção até{" "}
      {fmt1(data.bands.healthyMin / 10)}, saudável até {fmt1(data.bands.excellentMin / 10)} e excelente a
      partir daí.
    </div>
  );
}
