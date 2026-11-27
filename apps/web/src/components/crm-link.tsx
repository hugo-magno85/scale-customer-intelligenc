"use client";

import {
  CRM_ENTITY_LABELS,
  CRM_LABELS,
  CRM_PROVIDERS,
  type CrmEntityType,
  type CrmProviderKey,
  type CrmPublishSync,
  type MeetingCrmLink,
} from "@sci/contracts";
import { useState } from "react";
import { Button, Card, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const VAL = {
  pending: "Aguardando validação no CRM",
  validated: "Validado no CRM",
  failed: "Falha na validação",
} as const;

/** VINCULAR REGISTRO DO CRM — por URL ou ID; a reunião funciona sem vínculo. */
export function CrmLinkPanel({ meetingId, canEdit }: { meetingId: string; canEdit: boolean }) {
  const { can } = useSession();
  const links = useApi<MeetingCrmLink[]>(`/meetings/${meetingId}/crm-links`);
  const [provider, setProvider] = useState<CrmProviderKey>("pipedrive");
  const [entity, setEntity] = useState<CrmEntityType>("deal");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const active = links.data?.find((l) => l.active) ?? null;
  const history = links.data?.filter((l) => !l.active) ?? [];
  const mayChange = !active || can("crm.link.change");

  async function link() {
    setErr(null);
    try {
      await api(`/meetings/${meetingId}/crm-link`, {
        method: "POST",
        json: { provider, reference: ref, entityType: entity },
      });
      setRef("");
      await links.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Vincular registro do CRM
      </div>
      {active ? (
        <div className="text-sm">
          <div className="font-medium">
            {CRM_LABELS[active.provider]} · {CRM_ENTITY_LABELS[active.entityType]} #{active.externalRecordId}
          </div>
          {active.snapshot && (
            <div className="text-ink-soft">
              {[
                active.snapshot.company?.name,
                active.snapshot.deal?.title,
                active.snapshot.contact?.name,
                active.snapshot.owner && `resp.: ${active.snapshot.owner.name}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          <div className="text-xs text-ink-soft">
            {VAL[active.validationStatus]}
            {active.validationError ? ` — ${active.validationError}` : ""} · vínculo{" "}
            {active.origin === "manual" ? "manual" : "automático"} por {active.userName ?? "—"}
          </div>
          <PublishStatus meetingId={meetingId} />
          {active.recordUrl && (
            <a
              href={active.recordUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-brand"
            >
              Abrir no CRM
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">
          Nenhum registro vinculado. A reunião funciona normalmente e o vínculo pode ser feito depois.
        </p>
      )}
      {canEdit && mayChange && (
        <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto]">
          <select
            aria-label="CRM"
            className="rounded-lg border border-line px-2.5 py-2 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as CrmProviderKey)}
          >
            {CRM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {CRM_LABELS[p]}
              </option>
            ))}
          </select>
          <select
            aria-label="Tipo de registro"
            className="rounded-lg border border-line px-2.5 py-2 text-sm"
            value={entity}
            onChange={(e) => setEntity(e.target.value as CrmEntityType)}
          >
            {(["deal", "company", "contact", "lead"] as const).map((t) => (
              <option key={t} value={t}>
                {CRM_ENTITY_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            aria-label="URL ou ID do registro"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="Cole a URL completa do Deal/Card ou o ID"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <Button onClick={() => void link()} disabled={!ref.trim()}>
            {active ? "Alterar vínculo" : "Vincular"}
          </Button>
        </div>
      )}
      {canEdit && !mayChange && (
        <p className="text-xs text-ink-soft">Alterar o vínculo existente exige permissão específica.</p>
      )}
      {err && <ErrorText>{err}</ErrorText>}
      {history.length > 0 && (
        <details className="text-xs text-ink-soft">
          <summary>Histórico de vínculos ({history.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {history.map((h) => (
              <li key={h.id}>
                {CRM_LABELS[h.provider]} #{h.externalRecordId} · {h.userName ?? "—"} ·{" "}
                {new Date(h.createdAt).toLocaleString("pt-BR")} → substituído{" "}
                {h.replacedAt ? new Date(h.replacedAt).toLocaleString("pt-BR") : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

const SYNC: Record<CrmPublishSync["status"], string> = {
  pending: "Envio pendente",
  running: "Enviando…",
  succeeded: "Enviado ao CRM",
  failed: "Envio com falha",
  needs_approval: "Aguardando aprovação",
  cancelled: "Envio cancelado",
};

/** Situação do envio da análise ao registro vinculado (comentário, tarefas, campos) + reenvio. */
function PublishStatus({ meetingId }: { meetingId: string }) {
  const { can } = useSession();
  const syncs = useApi<CrmPublishSync[]>(`/meetings/${meetingId}/crm-publish`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = syncs.data?.[0];
  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/meetings/${meetingId}/crm-publish`, { method: "POST" });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
    await syncs.reload();
  }
  return (
    <div className="mt-2 rounded-lg border border-line bg-canvas/60 p-2.5 text-xs">
      {last ? (
        <>
          <div
            className={`font-medium ${last.status === "failed" ? "text-risk" : last.status === "succeeded" ? "text-healthy" : ""}`}
          >
            {SYNC[last.status]} · {new Date(last.updatedAt).toLocaleString("pt-BR")} ·{" "}
            {last.trigger === "auto" ? "automático" : "manual"}
          </div>
          <div className="text-ink-soft">
            {[
              last.noteId && (last.provider === "pipedrive" ? "nota no negócio" : "comentário na timeline"),
              last.taskIds.length &&
                `${last.taskIds.length} ${last.provider === "pipedrive" ? "atividade(s)" : "tarefa(s)"}`,
              last.fieldsUpdated.length && "campos de Health e risco",
            ]
              .filter(Boolean)
              .join(" · ") || "nada gravado ainda"}
          </div>
          {last.error && <div className="mt-1 text-risk">{last.error}</div>}
          {last.warnings.map((w) => (
            <div key={w} className="mt-1 text-attention">
              {w}
            </div>
          ))}
        </>
      ) : (
        <div className="text-ink-soft">A análise ainda não foi enviada ao CRM.</div>
      )}
      {can("crm.publish") &&
        last?.status !== "running" &&
        (last?.status !== "succeeded" || last.fieldsUpdated.length === 0) && (
          <Button variant="ghost" className="mt-2" disabled={busy} onClick={() => void send()}>
            {busy
              ? "Enviando…"
              : !last
                ? "Enviar análise ao CRM"
                : last.status === "succeeded"
                  ? "Tentar gravar os campos de novo"
                  : "Reenviar o que falhou"}
          </Button>
        )}
      {err && <ErrorText>{err}</ErrorText>}
    </div>
  );
}
