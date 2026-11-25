"use client";

import type { DashboardSummary } from "@sci/contracts";
import Link from "next/link";
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
        className={`mt-2 text-3xl font-semibold tabular-nums ${value == null ? "text-ink-soft/50" : (tone ?? "")}`}
      >
        {value ?? "—"}
      </div>
      {value == null && <div className="mt-1 text-xs text-ink-soft">{hint ?? "Sem dados suficientes"}</div>}
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

export default function DashboardPage() {
  const { data, error } = useApi<DashboardSummary>("/dashboard/summary");
  return (
    <>
      <PageHeader
        title="Dashboard Executivo"
        subtitle="Indicadores calculados apenas com dados reais da sua carteira e das reuniões analisadas."
      />
      {error && <ErrorText>{error}</ErrorText>}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Clientes ativos" href="/app/carteira" value={data.activeCustomers} />
          <Metric label="Reuniões analisadas" href="/app/calls" value={data.analyzedMeetings} />
          <Metric
            label="Customer Health médio"
            href="/app/health"
            value={data.averageHealth}
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Receita em risco"
            href="/app/churn"
            value={data.revenueAtRiskCents == null ? null : formatBRL(data.revenueAtRiskCents)}
            hint="Requer receita confiável e sinais de risco"
          />
          <Metric
            label="Saudáveis"
            href="/app/health"
            value={data.healthy}
            tone="text-healthy"
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Em atenção"
            href="/app/health"
            value={data.attention}
            tone="text-attention"
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Risco alto"
            href="/app/churn"
            value={data.highRisk}
            tone="text-risk"
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Oportunidades de expansão"
            href="/app/expansao"
            value={data.openExpansionOpportunities}
            hint="Identificadas nas reuniões"
          />
          <Metric label="Planos pendentes" href="/app/planos" value={data.pendingActionTasks} />
          <Metric
            label="Planos atrasados"
            href="/app/planos"
            value={data.overdueActionTasks}
            tone={data.overdueActionTasks ? "text-risk" : ""}
          />
        </div>
      )}
    </>
  );
}
