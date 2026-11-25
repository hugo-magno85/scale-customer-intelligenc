"use client";

import type { CustomerHealthRow } from "@sci/contracts";
import Link from "next/link";
import { HealthBadge } from "@/components/health";
import { Card, Empty, ErrorText, PageHeader } from "@/components/ui";
import { formatBRL } from "@/lib/api";
import { useApi } from "@/lib/use-api";

export default function HealthPage() {
  const { data, error } = useApi<CustomerHealthRow[]>("/health/customers");
  return (
    <>
      <PageHeader
        title="Customer Health"
        subtitle="Saúde de cada cliente calculada a partir das reuniões analisadas, com fatores explicáveis e pesos configuráveis."
      />
      {error && <ErrorText>{error}</ErrorText>}
      {data?.length === 0 && <Empty title="Nenhum cliente ativo" />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Health</th>
                <th className="px-5 py-3">Classificação</th>
                <th className="px-5 py-3">Tendência</th>
                <th className="px-5 py-3">Riscos abertos</th>
                <th className="px-5 py-3">Receita mensal</th>
                <th className="px-5 py-3">Última reunião</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.customerId} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-5 py-3">
                    <Link href={`/app/carteira/${r.customerId}`} className="font-medium hover:text-brand">
                      {r.customerName}
                    </Link>
                    <div className="text-xs text-ink-soft">
                      {[r.segment, r.ownerName].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-base font-semibold tabular-nums">
                    {r.score === null ? "—" : Math.round(r.score)}
                  </td>
                  <td className="px-5 py-3">
                    <HealthBadge value={r.classification} />
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {r.trend === null ? "—" : `${r.trend > 0 ? "▲ +" : r.trend < 0 ? "▼ " : ""}${r.trend}`}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{r.openRisks}</td>
                  <td className="px-5 py-3 tabular-nums">{formatBRL(r.mrrCents)}</td>
                  <td className="px-5 py-3 text-ink-soft">
                    {r.lastMeetingAt ? new Date(r.lastMeetingAt).toLocaleDateString("pt-BR") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
