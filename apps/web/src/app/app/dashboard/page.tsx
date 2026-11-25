"use client";

import { INDICATOR_LABELS, type Indicator, type ReportFilters, type ReportOverview } from "@sci/contracts";
import Link from "next/link";
import { useState } from "react";
import { RankBars, TrendLine, WeeklyBars } from "@/components/charts";
import { HealthBadge, SeverityBadge } from "@/components/health";
import { ReportFilterBar, toQuery } from "@/components/report-filters";
import { Card, ErrorText, PageHeader } from "@/components/ui";
import { formatBRL } from "@/lib/api";
import { useApi } from "@/lib/use-api";

function Metric({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  tone?: string;
  href?: string;
}) {
  const card = (
    <Card className={href ? "h-full transition hover:border-brand/40" : "h-full"}>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</div>
      <div
        className={`mt-2 font-semibold tabular-nums ${String(value ?? "").length > 8 ? "text-2xl" : "text-3xl"} ${value == null ? "text-ink-soft/50" : (tone ?? "")}`}
      >
        {value ?? "—"}
      </div>
      {value == null && <div className="mt-1 text-xs text-ink-soft">{hint ?? "Sem dados suficientes"}</div>}
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

export default function DashboardPage() {
  const [filters, setFilters] = useState<ReportFilters & { days?: number }>({ days: 90 });
  const { data, error } = useApi<ReportOverview>(`/reports/overview?${toQuery(filters)}`);
  const s = data?.summary;
  return (
    <>
      <PageHeader
        title="Dashboard Executivo"
        subtitle="Indicadores calculados apenas com dados reais da carteira e das reuniões analisadas."
      />
      <ReportFilterBar value={filters} onChange={setFilters} />
      {error && <ErrorText>{error}</ErrorText>}
      {s && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Clientes ativos" href="/app/carteira" value={s.activeCustomers} />
            <Metric
              label="Customer Health médio"
              href="/app/health"
              value={s.averageHealth}
              hint="Disponível após as primeiras análises"
            />
            <Metric
              label="Saudáveis"
              href="/app/health"
              value={s.healthy}
              tone="text-healthy"
              hint="Disponível após as primeiras análises"
            />
            <Metric
              label="Em atenção"
              href="/app/health"
              value={s.attention}
              tone="text-attention"
              hint="Disponível após as primeiras análises"
            />
            <Metric
              label="Risco alto"
              href="/app/churn"
              value={s.highRisk}
              tone="text-risk"
              hint="Disponível após as primeiras análises"
            />
            <Metric
              label="Receita em risco"
              href="/app/churn"
              value={s.revenueAtRiskCents == null ? null : formatBRL(s.revenueAtRiskCents)}
              hint="Requer receita informada e sinal alto/crítico"
            />
            <Metric
              label="Oportunidades de expansão"
              href="/app/expansao"
              value={s.openExpansionOpportunities}
            />
            <Metric label="Reuniões analisadas" href="/app/calls" value={s.analyzedMeetings} />
            <Metric label="Planos pendentes" href="/app/planos" value={s.pendingActionTasks} />
            <Metric
              label="Planos atrasados"
              href="/app/planos"
              value={s.overdueActionTasks}
              tone={s.overdueActionTasks ? "text-risk" : ""}
            />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <Card>
              <h2 className="font-semibold">Customer Health médio por semana</h2>
              <p className="mb-3 text-xs text-ink-soft">
                Média das notas registradas em cada semana (clientes do filtro).
              </p>
              <TrendLine
                label="Customer Health médio por semana"
                points={data.weekly.map((w) => ({ x: w.week, y: w.averageHealth }))}
              />
            </Card>
            <Card>
              <h2 className="font-semibold">Reuniões analisadas por semana</h2>
              <p className="mb-3 text-xs text-ink-soft">Base de toda a inteligência da carteira.</p>
              <WeeklyBars
                label="Reuniões analisadas por semana"
                points={data.weekly.map((w) => ({ x: w.week, y: w.analyzedMeetings }))}
              />
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">Principais fatores de risco abertos</h2>
              <p className="-mt-2 mb-3 text-xs text-ink-soft">Número de clientes com o fator em aberto.</p>
              <RankBars items={data.topRiskFactors.map((f) => ({ label: f.label, value: f.customers }))} />
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">Média dos indicadores no período</h2>
              {data.indicatorAverages.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-soft">Sem indicadores no período.</p>
              ) : (
                <RankBars
                  items={data.indicatorAverages.map((i) => ({
                    label: `${INDICATOR_LABELS[i.indicator as Indicator]}${i.indicator === "churn_risk" ? " — quanto maior, pior" : ""} (${i.samples} reuniões)`,
                    value: i.average ?? 0,
                  }))}
                />
              )}
            </Card>
          </div>

          <h2 className="mb-3 mt-8 text-lg font-semibold">
            Clientes que compõem os indicadores ({data.customers.length})
          </h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Health</th>
                  <th className="px-5 py-3">Classificação</th>
                  <th className="px-5 py-3">Maior risco</th>
                  <th className="px-5 py-3">Riscos abertos</th>
                  <th className="px-5 py-3">Reuniões no período</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                    <td className="px-5 py-3">
                      <Link href={`/app/carteira/${c.id}`} className="font-medium hover:text-brand">
                        {c.name}
                      </Link>
                      <div className="text-xs text-ink-soft">
                        {[c.segment, c.ownerName].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      {c.healthScore === null ? "—" : Math.round(c.healthScore)}
                    </td>
                    <td className="px-5 py-3">
                      <HealthBadge value={c.healthClass} />
                    </td>
                    <td className="px-5 py-3">
                      {c.maxSeverity ? <SeverityBadge value={c.maxSeverity} /> : "—"}
                    </td>
                    <td className="px-5 py-3 tabular-nums">{c.openRisks}</td>
                    <td className="px-5 py-3 tabular-nums">{c.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
