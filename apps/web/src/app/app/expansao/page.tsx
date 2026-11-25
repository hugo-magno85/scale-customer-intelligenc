"use client";

import type { ExpansionOpportunity } from "@sci/contracts";
import Link from "next/link";
import { Card, Empty, ErrorText, PageHeader } from "@/components/ui";
import { api, formatBRL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const STATUS = {
  open: "Aberta",
  qualified: "Qualificada",
  won: "Ganha",
  lost: "Perdida",
  discarded: "Descartada",
} as const;

export default function ExpansionPage() {
  const { can } = useSession();
  const { data, error, reload } = useApi<ExpansionOpportunity[]>("/opportunities");
  async function patch(id: string, json: object) {
    await api(`/opportunities/${id}`, { method: "PATCH", json });
    await reload();
  }
  return (
    <>
      <PageHeader
        title="Oportunidades de Expansão"
        subtitle="Upsell, cross-sell e novas necessidades identificadas nas reuniões. Valores só quando informados por pessoas ou pelo CRM."
      />
      {error && <ErrorText>{error}</ErrorText>}
      {data?.length === 0 && <Empty title="Nenhuma oportunidade identificada ainda" />}
      <div className="grid gap-3 lg:grid-cols-2">
        {data?.map((o) => (
          <Card key={o.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-soft">{o.typeLabel}</div>
                <Link href={`/app/carteira/${o.customerId}`} className="font-semibold hover:text-brand">
                  {o.customerName}
                </Link>
              </div>
              {can("action_plans.manage") ? (
                <select
                  className="rounded-md border border-line px-2 py-1 text-sm"
                  value={o.status}
                  onChange={(e) => void patch(o.id, { status: e.target.value })}
                  aria-label="Status"
                >
                  {Object.entries(STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm">{STATUS[o.status]}</span>
              )}
            </div>
            <p className="mt-2 text-sm">{o.need}</p>
            <blockquote className="mt-2 border-l-2 border-brand/40 pl-3 text-sm text-ink-soft">
              “{o.evidence[0]?.text}”
            </blockquote>
            {o.nextAction && (
              <p className="mt-2 text-sm">
                <span className="font-medium">Próxima ação:</span> {o.nextAction}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-soft">
              <span>Responsável: {o.ownerName ?? "—"}</span>
              <span>
                Potencial: {o.potentialCents === null ? "não informado" : formatBRL(o.potentialCents)}
              </span>
              {can("action_plans.manage") && (
                <button
                  className="text-brand"
                  onClick={() => {
                    const v = prompt("Potencial mensal estimado pela sua equipe (R$):");
                    if (v && !Number.isNaN(Number(v.replace(",", "."))))
                      void patch(o.id, { potentialCents: Math.round(Number(v.replace(",", ".")) * 100) });
                  }}
                >
                  Informar potencial
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
