"use client";

import type { ReportFilters } from "@sci/contracts";
import { Download } from "lucide-react";
import { useState } from "react";
import { ReportFilterBar, toQuery } from "@/components/report-filters";
import { Button, Card, ErrorText, PageHeader } from "@/components/ui";
import { getTenantId } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const EXPORTS = [
  {
    type: "customers",
    title: "Carteira e Customer Health",
    desc: "Clientes, responsável, nota e classificação, riscos abertos e receita.",
  },
  {
    type: "meetings",
    title: "Reuniões",
    desc: "Data, cliente, responsável, plataforma, status e resumo da análise.",
  },
  {
    type: "indicators",
    title: "Evolução dos indicadores",
    desc: "Nota, confiança e evidência de cada indicador por reunião.",
  },
  {
    type: "churn",
    title: "Churn Radar",
    desc: "Fatores de risco, severidade, recorrência, evidência e receita em risco.",
  },
  {
    type: "opportunities",
    title: "Oportunidades de expansão",
    desc: "Tipo, necessidade, status, potencial informado e evidência.",
  },
  {
    type: "tasks",
    title: "Tarefas",
    desc: "Tarefas, responsáveis, prazos, prioridade e status (inclui atrasadas).",
  },
] as const;

export default function ReportsPage() {
  const [filters, setFilters] = useState<ReportFilters & { days?: number }>({ days: 90 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function download(type: string) {
    setBusy(type);
    setErr(null);
    try {
      const tenant = getTenantId();
      const res = await fetch(`${BASE}/v1/reports/export?type=${type}&${toQuery(filters)}`, {
        credentials: "include",
        headers: tenant ? { "x-tenant-id": tenant } : {},
      });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({})))?.error?.message ?? "Falha na exportação");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `scale-${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Relatórios e Indicadores"
        subtitle="Exportações em CSV (abrem no Excel) com os mesmos filtros do dashboard. Toda exportação fica registrada na auditoria."
      />
      <ReportFilterBar value={filters} onChange={setFilters} />
      {err && <ErrorText>{err}</ErrorText>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {EXPORTS.map((e) => (
          <Card key={e.type} className="flex flex-col justify-between gap-4">
            <div>
              <h2 className="font-semibold">{e.title}</h2>
              <p className="mt-1 text-sm text-ink-soft">{e.desc}</p>
            </div>
            <div>
              <Button variant="ghost" onClick={() => void download(e.type)} disabled={busy === e.type}>
                <Download size={15} /> {busy === e.type ? "Gerando…" : "Exportar CSV"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
