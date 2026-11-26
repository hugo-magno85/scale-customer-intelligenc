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
  Gauge,
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
import { BiFilterBar, biQuery, DEFAULT_BI, type BiState } from "@/components/bi-filters";
import { HealthBadge, SeverityBadge } from "@/components/health";
import { formatBRL } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/* ---------------------------------------------------------------- KPIs -- */

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
    format: (v) => formatBRL(v),
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
    label: "Planos pendentes",
    Icon: ListChecks,
    color: BI.blue,
    format: String,
    drill: "pending",
  },
  overdue_tasks: { label: "Planos atrasados", Icon: Clock, color: BI.red, format: String, drill: "overdue" },
};

const SHARE_LABEL: Partial<Record<BiKpiKey, string>> = {
  healthy: "dos clientes avaliados",
  attention: "dos clientes avaliados",
  high_risk: "dos clientes avaliados",
  expansion: "da carteira com potencial",
  overdue_tasks: "das pendentes",
};

function KpiCard({ kpi, onDrill }: { kpi: BiKpi; onDrill: (key: string) => void }) {
  const m = KPI_META[kpi.key];
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl"
          style={{ background: `${m.color}14`, color: m.color }}
        >
          <m.Icon size={16} aria-hidden />
        </span>
        <Tip text={`${kpi.source}${kpi.comparison.note ? ` ${kpi.comparison.note}.` : ""}`} />
      </div>
      <div className="mt-3 text-center text-[11px] font-medium uppercase tracking-wide text-ink-soft">
        {m.label}
      </div>
      <div
        className={`mt-1 text-center font-semibold tabular-nums tracking-tight ${
          kpi.value !== null && m.format(kpi.value).length > 9 ? "text-2xl" : "text-[32px] leading-10"
        } ${kpi.value === null ? "text-ink-soft/40" : ""}`}
      >
        {kpi.value === null ? "—" : m.format(kpi.value)}
      </div>
      <div className="mt-1 flex min-h-5 flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {kpi.value === null ? (
          <span className="text-[11px] text-ink-soft">
            {kpi.key === "revenue_at_risk" ? "Sem receita informada nos sinais" : "Sem dados suficientes"}
          </span>
        ) : (
          <>
            {kpi.share !== null && (
              <span className="text-[11px] text-ink-soft">
                {fmtShare(kpi.share)} {SHARE_LABEL[kpi.key]}
              </span>
            )}
            <Delta comparison={kpi.comparison} direction={kpi.direction} />
          </>
        )}
      </div>
      <div className="mt-2">
        <Sparkline values={kpi.spark} color={m.color} />
      </div>
    </>
  );
  const cls =
    "bi-rise group block h-full rounded-2xl border border-white/70 bg-white/85 p-4 text-left shadow-[0_1px_2px_rgba(15,23,41,0.04),0_8px_24px_-14px_rgba(15,23,41,0.12)] backdrop-blur transition hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(15,23,41,0.04),0_14px_30px_-14px_rgba(37,99,235,0.25)]";
  if (m.href)
    return (
      <Link href={m.href} className={cls}>
        {body}
      </Link>
    );
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${cls} cursor-pointer`}
      onClick={() => onDrill(m.drill!)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onDrill(m.drill!)}
    >
      {body}
    </div>
  );
}

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

const PORTFOLIO_LABEL: Record<string, string> = {
  Excelente: "Carteira excelente",
  Saudável: "Carteira saudável",
  Atenção: "Carteira em atenção",
  Crítico: "Carteira em risco crítico",
};

function HealthHero({ data }: { data: ReportBi }) {
  const g = data.gauge;
  const band = bandOf(g.score, data.bands);
  const Row = ({ label, v, pct }: { label: string; v: number | null; pct?: number | null }) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <b className="font-semibold">{v === null ? "—" : fmt1(v / 10)}</b>
        {pct !== undefined &&
          (pct === null ? (
            <span className="w-14 text-right text-[11px] text-ink-soft">
              {v === null ? "sem histórico" : ""}
            </span>
          ) : (
            <span
              className={`w-14 text-right text-[11px] font-semibold ${pct >= 0 ? "text-[#0f8a5a]" : "text-[#c2304a]"}`}
            >
              {fmtPct(pct)}
            </span>
          ))}
      </span>
    </div>
  );
  return (
    <Panel className="h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Customer Health Score
        </h3>
        <Tip text="Média da última nota de cada cliente da carteira filtrada, convertida para a escala de 0 a 10. As faixas seguem as regras de classificação configuradas (Configurações → Customer Health)." />
      </div>
      <div className="mt-2">
        <Gauge score100={g.score} bands={data.bands} />
        <div className="-mt-1 text-center text-[40px] font-semibold leading-none tabular-nums tracking-tight">
          {g.score === null ? "—" : fmt1(g.score / 10)}
          <span className="text-base font-medium text-ink-soft"> / 10</span>
        </div>
      </div>
      <div className="mt-3 text-center">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: `${band.color}18`, color: band.color }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: band.color }} />
          {g.score === null ? "Sem dados suficientes" : (PORTFOLIO_LABEL[band.label] ?? band.label)}
        </span>
        <div className="mt-1 text-[11px] text-ink-soft">
          {g.customersWithHealth} de {g.activeCustomers} clientes com nota
        </div>
      </div>
      <div className="mt-4 divide-y divide-line/70 border-t border-line/70">
        <Row label="Atual (fim do período)" v={g.score} />
        <Row label="Fim do mês anterior" v={g.previousMonth} pct={g.monthDeltaPct} />
        <Row label="Mesma data, ano anterior" v={g.previousYear} pct={g.yearDeltaPct} />
      </div>
    </Panel>
  );
}

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

/* --------------------------------------------------------------- página -- */

export default function DashboardPage() {
  const [filters, setFilters] = useState<BiState>(DEFAULT_BI);
  const [drill, setDrill] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<ReportBi>(`/reports/bi?${biQuery(filters)}`);
  const labels = useMemo(() => data?.buckets.map((b) => b.label) ?? [], [data]);
  const kpi = (k: BiKpiKey) => data?.kpis.find((x) => x.key === k);
  const cmpLabel = filters.compare === "year" ? "Ano anterior" : "Período anterior";
  const gran = data?.period.granularity === "month" ? "mês" : "semana";

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-bi-blue">
            Customer Intelligence
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-[28px]">Dashboard Executivo</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {data
              ? `${fmtDate(data.period.from)} a ${fmtDate(data.period.to)} · comparado com ${fmtDate(data.period.compareFrom)} a ${fmtDate(data.period.compareTo)}`
              : "Visão estratégica da carteira com dados reais das reuniões analisadas."}
          </p>
        </div>
        {loading && data && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <RefreshCw size={13} className="animate-spin" aria-hidden /> Atualizando…
          </span>
        )}
      </div>
      <BiFilterBar
        value={filters}
        onChange={(v) => {
          setFilters(v);
          setDrill(null);
        }}
      />

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
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-96 lg:col-span-4" />
          <Skeleton className="h-96 lg:col-span-8" />
          <Skeleton className="h-44 lg:col-span-12" />
        </div>
      )}

      {data && (
        <div className={loading ? "opacity-70 transition-opacity" : "transition-opacity"}>
          {/* Protagonista + evolução */}
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <HealthHero data={data} />
            </div>
            <Panel
              className="lg:col-span-8"
              title="Evolução do Customer Health"
              subtitle={`Nota média da carteira ao fim de cada ${gran} (0 a 10), com o ${cmpLabel.toLowerCase()} e a linha de tendência.`}
            >
              <AreaCompare
                labels={labels}
                current={data.healthSeries.map((p) => toTen(p.value))}
                previous={data.healthSeries.map((p) => toTen(p.previous))}
                max={10}
                format={(v) => fmt1(v)}
                ariaLabel="Evolução do Customer Health"
                currentLabel="Período"
                previousLabel={cmpLabel}
              />
            </Panel>
          </div>

          {/* KPIs */}
          <SectionTitle hint="Clique em um indicador para ver os clientes">
            Indicadores estratégicos da carteira
          </SectionTitle>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {data.kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} onDrill={setDrill} />
            ))}
          </div>
          {drill && <DrillPanel drill={drill} customers={data.customers} onClose={() => setDrill(null)} />}

          {/* Evolução */}
          <SectionTitle>Análises temporais</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-12">
            <Panel
              className="lg:col-span-7"
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
              className="lg:col-span-5"
              title="Distribuição da carteira"
              subtitle="Classificação ao fim do período. Clique para detalhar."
            >
              <Donut
                centerLabel="clientes"
                onSelect={setDrill}
                items={[
                  { key: "healthy", label: "Saudáveis", value: data.distribution.healthy, color: BI.green },
                  {
                    key: "attention",
                    label: "Em atenção",
                    value: data.distribution.attention,
                    color: BI.orange,
                  },
                  { key: "high_risk", label: "Risco alto", value: data.distribution.highRisk, color: BI.red },
                  {
                    key: "no_data",
                    label: "Sem nota ainda",
                    value: data.distribution.noData,
                    color: "#CBD5E1",
                  },
                ]}
              />
            </Panel>
            <Panel
              className="lg:col-span-12"
              title="Evolução do risco"
              subtitle={`Mudança de classificação entre o início (${fmtDate(data.period.from)}) e o fim do período, para clientes com nota nas duas datas.`}
            >
              {data.movement.comparable === 0 ? (
                <Empty title="Histórico insuficiente">
                  Nenhum cliente tinha nota antes do início do período, então não dá para medir mudanças de
                  classificação.
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
                          <span className="ml-2 text-xs text-ink-soft">{fmtShare(f.share)} da carteira</span>
                        )}
                      </span>
                    ),
                    value: f.customers,
                    note: (
                      <span>
                        Novos no período: {f.newInPeriod} ({cmpLabel.toLowerCase()}: {f.newInComparison}) ·{" "}
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
                    data.churn.revenue.atRiskCents === null ? "—" : formatBRL(data.churn.revenue.atRiskCents)
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
                        <tr key={p.id} className="border-b border-line/70 last:border-0 hover:bg-canvas/60">
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
                              <div className="text-xs text-ink-soft">{p.openTasks} ação(ões) aberta(s)</div>
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
                hint={data.plans.avgCompletionDays === null ? "sem conclusões no período" : "para concluir"}
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
