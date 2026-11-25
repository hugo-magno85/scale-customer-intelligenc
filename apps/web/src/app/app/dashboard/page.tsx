"use client";

import type { DashboardSummary } from "@sci/contracts";
import { Card, ErrorText, PageHeader } from "@/components/ui";
import { formatBRL } from "@/lib/api";
import { useApi } from "@/lib/use-api";

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</div>
      <div
        className={`mt-2 text-3xl font-semibold tabular-nums ${value == null ? "text-ink-soft/50" : (tone ?? "")}`}
      >
        {value ?? "—"}
      </div>
      {value == null && <div className="mt-1 text-xs text-ink-soft">{hint ?? "Sem dados suficientes"}</div>}
    </Card>
  );
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
          <Metric label="Clientes ativos" value={data.activeCustomers} />
          <Metric label="Reuniões analisadas" value={data.analyzedMeetings} />
          <Metric
            label="Customer Health médio"
            value={data.averageHealth}
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Receita em risco"
            value={data.revenueAtRiskCents == null ? null : formatBRL(data.revenueAtRiskCents)}
            hint="Requer receita confiável e sinais de risco"
          />
          <Metric
            label="Saudáveis"
            value={data.healthy}
            tone="text-healthy"
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Em atenção"
            value={data.attention}
            tone="text-attention"
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Risco alto"
            value={data.highRisk}
            tone="text-risk"
            hint="Disponível após as primeiras análises"
          />
          <Metric
            label="Oportunidades de expansão"
            value={data.openExpansionOpportunities}
            hint="Identificadas nas reuniões"
          />
        </div>
      )}
    </>
  );
}
