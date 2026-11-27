"use client";

import {
  MEETING_PLATFORM_LABELS,
  MEETING_TYPE_LABELS,
  type ActionTask,
  type Customer,
  type Meeting,
  type MeetingAnalysis,
  type TranscriptSegment,
} from "@sci/contracts";
import { AnalysisView } from "@/components/analysis";
import { CrmLinkPanel } from "@/components/crm-link";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Card, Empty, ErrorText, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const CONSENT: Record<string, string> = {
  verbal_announcement: "Aviso verbal no início da reunião",
  written: "Aviso por escrito",
  platform_notice: "Aviso da plataforma",
};

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const m = useApi<Meeting>(`/meetings/${id}`);
  const tr = useApi<TranscriptSegment[]>(`/meetings/${id}/transcript`);
  const customers = useApi<{ items: Customer[] }>(can("customers.read") ? "/customers?limit=100" : null);
  const [err, setErr] = useState<string | null>(null);
  const analysis = useApi<MeetingAnalysis | null>(can("analyses.read") ? `/meetings/${id}/analysis` : null);
  const tasks = useApi<ActionTask[]>(can("action_plans.read") ? `/tasks?meetingId=${id}` : null);

  async function reanalyze() {
    try {
      await api(`/meetings/${id}/analyze`, { method: "POST" });
      setTimeout(() => void Promise.all([analysis.reload(), tasks.reload(), m.reload()]), 1500);
      await analysis.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function link(customerId: string) {
    try {
      await api(`/meetings/${id}`, { method: "PATCH", json: { customerId: customerId || null } });
      await m.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (m.error) return <ErrorText>{m.error}</ErrorText>;
  if (!m.data) return null;
  const d = m.data;
  return (
    <>
      <Link href="/app/calls" className="text-sm text-ink-soft hover:text-ink">
        ← Reuniões
      </Link>
      <PageHeader
        title={d.title ?? MEETING_TYPE_LABELS[d.meetingType]}
        subtitle={`${MEETING_PLATFORM_LABELS[d.platform]} · ${d.ownerName ?? ""}`}
      />
      {err && <ErrorText>{err}</ErrorText>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-soft">Cliente</div>
          {can("meetings.capture") && customers.data ? (
            <select
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
              value={d.customerId ?? ""}
              onChange={(e) => void link(e.target.value)}
            >
              <option value="">Não vinculado</option>
              {customers.data.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-1 font-medium">{d.customerName ?? "Não vinculado"}</div>
          )}
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-soft">Playbook e skill</div>
          <div className="mt-1 font-medium">
            {d.playbookName ? `${d.playbookName} · v${d.playbookVersionNumber}` : "Sem playbook"}
          </div>
          <div className="text-xs text-ink-soft">Skill de CS v{d.skillVersion}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-soft">Consentimento</div>
          <div className="mt-1 font-medium">
            {d.consentMethod ? CONSENT[d.consentMethod] : "Não registrado"}
          </div>
          {d.consentConfirmedAt && (
            <div className="text-xs text-ink-soft">
              {new Date(d.consentConfirmedAt).toLocaleString("pt-BR")}
            </div>
          )}
        </Card>
      </div>
      {d.participants.length > 0 && (
        <p className="mt-4 text-sm text-ink-soft">
          Participantes: {d.participants.map((p) => p.displayName).join(", ")}
        </p>
      )}
      <div className="mt-4">
        <CrmLinkPanel meetingId={d.id} canEdit={can("meetings.capture")} />
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Transcrição</h2>
      {tr.data?.length === 0 && (
        <Empty title="Sem transcrição">A transcrição aparece aqui após a captura pelo Scale Assistant.</Empty>
      )}
      {tr.data && tr.data.length > 0 && (
        <Card className="space-y-3">
          {tr.data.map((s) => (
            <div key={s.id} className="flex gap-3 text-sm">
              <span className="w-12 shrink-0 tabular-nums text-ink-soft">{fmt(s.startMs)}</span>
              <span className={`w-16 shrink-0 font-medium ${s.speaker === "customer" ? "text-brand" : ""}`}>
                {s.speaker === "customer" ? "Cliente" : "CS"}
              </span>
              <span>{s.text}</span>
            </div>
          ))}
        </Card>
      )}
      {(d.status === "ended" || d.status === "analyzed") && can("analyses.read") && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Análise da reunião</h2>
          <AnalysisView
            a={analysis.data ?? null}
            onReanalyze={() => void reanalyze()}
            canAct={can("meetings.capture")}
          />
          {tasks.data && tasks.data.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 text-lg font-semibold">Tarefas da reunião</h2>
              <Card className="space-y-2">
                {tasks.data.map((t) => (
                  <div key={t.id} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span className={t.status === "cancelled" ? "text-ink-soft line-through" : "font-medium"}>
                      {t.title}
                    </span>
                    <span className="text-ink-soft">
                      {t.ownerName ?? (t.responsibleParty === "customer" ? "Cliente" : "—")} ·{" "}
                      {t.dueDate
                        ? new Date(t.dueDate + "T00:00:00").toLocaleDateString("pt-BR")
                        : "sem prazo"}
                    </span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
