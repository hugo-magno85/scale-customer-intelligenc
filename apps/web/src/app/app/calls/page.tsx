"use client";

import { MEETING_PLATFORM_LABELS, MEETING_TYPE_LABELS, type Meeting } from "@sci/contracts";
import Link from "next/link";
import { Card, Empty, ErrorText, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/use-api";

const STATUS_LABEL: Record<Meeting["status"], string> = {
  preparing: "Preparada",
  live: "Em captura",
  ended: "Encerrada",
  analyzed: "Analisada",
};

export default function CallsPage() {
  const { data, error } = useApi<Meeting[]>("/meetings?limit=100");
  return (
    <>
      <PageHeader
        title="Assistente de Calls"
        subtitle="Reuniões acompanhadas pelo Scale Assistant no Google Meet, Zoom e Microsoft Teams."
      />
      {error && <ErrorText>{error}</ErrorText>}
      {data?.length === 0 && (
        <Empty title="Nenhuma reunião ainda">
          Instale o Scale Assistant no Chrome, abra uma reunião e prepare-a pelo painel lateral.
        </Empty>
      )}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-5 py-3">Reunião</th>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Playbook</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Data</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-5 py-3">
                    <Link href={`/app/calls/${m.id}`} className="font-medium hover:text-brand">
                      {m.title ?? MEETING_TYPE_LABELS[m.meetingType]}
                    </Link>
                    <div className="text-xs text-ink-soft">{MEETING_PLATFORM_LABELS[m.platform]}</div>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{m.customerName ?? "Não vinculado"}</td>
                  <td className="px-5 py-3 text-ink-soft">
                    {m.playbookName ? `${m.playbookName} · v${m.playbookVersionNumber}` : "—"}
                  </td>
                  <td className="px-5 py-3">{STATUS_LABEL[m.status]}</td>
                  <td className="px-5 py-3 text-ink-soft">
                    {new Date(m.startedAt ?? m.createdAt).toLocaleString("pt-BR")}
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
