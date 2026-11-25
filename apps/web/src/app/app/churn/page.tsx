"use client";

import type { ChurnSignal } from "@sci/contracts";
import Link from "next/link";
import { useState } from "react";
import { SeverityBadge } from "@/components/health";
import { Card, Empty, ErrorText, PageHeader } from "@/components/ui";
import { api, formatBRL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const STATUS = { open: "Aberto", monitoring: "Em acompanhamento", resolved: "Resolvido" } as const;

export default function ChurnPage() {
  const { can } = useSession();
  const [status, setStatus] = useState<"open" | "monitoring" | "resolved" | "">("open");
  const { data, error, reload } = useApi<ChurnSignal[]>(`/churn-signals${status ? `?status=${status}` : ""}`);
  // Receita conta uma vez por cliente (vários fatores de risco do mesmo cliente não somam)
  const byCustomer = new Map<string, number>();
  for (const c of data ?? [])
    if (c.revenueAtRiskCents !== null)
      byCustomer.set(c.customerId, Math.max(byCustomer.get(c.customerId) ?? 0, c.revenueAtRiskCents));
  const totalRisk = [...byCustomer.values()].reduce((a, b) => a + b, 0);
  const hasRevenue = data?.some((c) => c.revenueAtRiskCents !== null);

  async function update(id: string, s: string) {
    await api(`/churn-signals/${id}`, { method: "PATCH", json: { status: s } });
    await reload();
  }

  return (
    <>
      <PageHeader
        title="Churn Radar"
        subtitle="Sinais de risco identificados nas reuniões, com evidência, recorrência e recomendação."
        actions={
          <select
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            aria-label="Status"
          >
            <option value="open">Abertos</option>
            <option value="monitoring">Em acompanhamento</option>
            <option value="resolved">Resolvidos</option>
            <option value="">Todos</option>
          </select>
        }
      />
      {hasRevenue && (
        <Card className="mb-4">
          <div className="text-xs uppercase tracking-wide text-ink-soft">
            Receita mensal em risco (clientes com sinal alto ou crítico e receita informada)
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatBRL(totalRisk)}</div>
        </Card>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {data?.length === 0 && <Empty title="Nenhum sinal neste filtro" />}
      <div className="space-y-3">
        {data?.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <SeverityBadge value={c.severity} />
                  <span className="font-semibold">{c.factorLabel}</span>
                  {c.recurrence > 1 && (
                    <span className="text-xs text-ink-soft">· recorrente ({c.recurrence} reuniões)</span>
                  )}
                </div>
                <Link href={`/app/carteira/${c.customerId}`} className="mt-1 block text-sm hover:text-brand">
                  {c.customerName}
                  {c.ownerName ? <span className="text-ink-soft"> · {c.ownerName}</span> : null}
                </Link>
              </div>
              <div className="text-right text-sm">
                {c.revenueAtRiskCents !== null && (
                  <div className="font-semibold tabular-nums">{formatBRL(c.revenueAtRiskCents)}/mês</div>
                )}
                <div className="text-xs text-ink-soft">
                  desde {new Date(c.firstSeenAt).toLocaleDateString("pt-BR")} · último{" "}
                  {new Date(c.lastSeenAt).toLocaleDateString("pt-BR")}
                </div>
              </div>
            </div>
            <blockquote className="mt-3 border-l-2 border-risk/40 pl-3 text-sm text-ink-soft">
              “{c.evidence[0]?.text}”
            </blockquote>
            <p className="mt-2 text-sm">
              <span className="font-medium">Recomendação:</span> {c.recommendation}
            </p>
            {c.nextAction && (
              <p className="text-sm">
                <span className="font-medium">Próxima ação:</span> {c.nextAction}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              {c.lastMeetingId && (
                <Link href={`/app/calls/${c.lastMeetingId}`} className="text-brand">
                  Ver reunião
                </Link>
              )}
              {can("action_plans.manage") && (
                <select
                  className="rounded-md border border-line px-2 py-1"
                  value={c.status}
                  onChange={(e) => void update(c.id, e.target.value)}
                  aria-label="Status do sinal"
                >
                  {Object.entries(STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
