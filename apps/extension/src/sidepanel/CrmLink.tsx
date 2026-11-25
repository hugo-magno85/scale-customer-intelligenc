import {
  CRM_ENTITY_LABELS,
  CRM_LABELS,
  CRM_PROVIDERS,
  type CrmEntityType,
  type CrmProviderKey,
  type MeetingCrmLink,
  type ParsedCrmReference,
} from "@sci/contracts";
import { useEffect, useState } from "react";
import { api } from "./api.js";

/** VINCULAR REGISTRO DO CRM: selecionar CRM → informar URL/ID → consultar → conferir → confirmar. */
export function CrmLink({ meetingId }: { meetingId: string }) {
  const [links, setLinks] = useState<MeetingCrmLink[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<CrmProviderKey>("pipedrive");
  const [entity, setEntity] = useState<CrmEntityType>("deal");
  const [ref, setRef] = useState("");
  const [preview, setPreview] = useState<ParsedCrmReference | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    api<MeetingCrmLink[]>(`/meetings/${meetingId}/crm-links`)
      .then(setLinks)
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, [meetingId]);
  const active = links.find((l) => l.active) ?? null;

  async function consult() {
    setErr(null);
    setPreview(null);
    try {
      setPreview(
        await api<ParsedCrmReference>("/crm/parse-reference", {
          json: { provider, reference: ref, entityType: entity },
        }),
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function confirm() {
    try {
      setLinks(
        await api<MeetingCrmLink[]>(`/meetings/${meetingId}/crm-link`, {
          json: { provider, reference: ref, entityType: entity },
        }),
      );
      setOpen(false);
      setPreview(null);
      setRef("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="card stack">
      <div className="row between">
        <div className="brand">VINCULAR REGISTRO DO CRM</div>
        <button className="btn ghost" onClick={() => setOpen(!open)}>
          {active ? "Alterar" : "Vincular"}
        </button>
      </div>
      {active ? (
        <dl className="kv">
          <dt>CRM</dt>
          <dd>{CRM_LABELS[active.provider]}</dd>
          <dt>Registro</dt>
          <dd>
            {CRM_ENTITY_LABELS[active.entityType]} · ID {active.externalRecordId}
          </dd>
          {active.snapshot?.company && (
            <>
              <dt>Empresa</dt>
              <dd>{active.snapshot.company.name}</dd>
            </>
          )}
          {active.snapshot?.deal && (
            <>
              <dt>Negócio</dt>
              <dd>{active.snapshot.deal.title}</dd>
            </>
          )}
          {active.snapshot?.contact && (
            <>
              <dt>Contato</dt>
              <dd>{active.snapshot.contact.name}</dd>
            </>
          )}
          {active.snapshot?.owner && (
            <>
              <dt>Responsável</dt>
              <dd>{active.snapshot.owner.name}</dd>
            </>
          )}
          <dt>Situação</dt>
          <dd>
            {active.validationStatus === "validated"
              ? "Validado no CRM"
              : active.validationStatus === "failed"
                ? `Falha: ${active.validationError ?? ""}`
                : "Aguardando validação no CRM"}
          </dd>
          {active.recordUrl && (
            <>
              <dt>Link</dt>
              <dd>
                <a href={active.recordUrl} target="_blank" rel="noreferrer noopener">
                  Abrir registro
                </a>
              </dd>
            </>
          )}
        </dl>
      ) : (
        !open && (
          <p className="muted">Sem vínculo. A reunião funciona normalmente; você pode vincular depois.</p>
        )
      )}
      {open && (
        <div className="stack">
          <label>
            CRM
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as CrmProviderKey);
                setPreview(null);
              }}
            >
              {CRM_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {CRM_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de registro
            <select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as CrmEntityType);
                setPreview(null);
              }}
            >
              {(["deal", "company", "contact", "lead"] as const).map((t) => (
                <option key={t} value={t}>
                  {CRM_ENTITY_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            URL completa do Deal/Card ou ID
            <input
              value={ref}
              onChange={(e) => {
                setRef(e.target.value);
                setPreview(null);
              }}
              placeholder="https://… ou 12345"
            />
          </label>
          <button className="btn ghost" disabled={!ref.trim()} onClick={() => void consult()}>
            Consultar
          </button>
          {preview && (
            <div className="seg">
              <b>Confira antes de confirmar</b>
              {CRM_LABELS[preview.provider]} · {CRM_ENTITY_LABELS[preview.entityType]} · ID{" "}
              {preview.externalRecordId}
              {preview.externalAccountId ? ` · conta ${preview.externalAccountId}` : ""}
              <div className="muted">
                Os dados da empresa, negócio, contato e responsável são buscados no CRM quando a integração
                estiver ativa.
              </div>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => void confirm()}>
                Confirmar vínculo
              </button>
            </div>
          )}
          {err && <p className="error">{err}</p>}
        </div>
      )}
    </div>
  );
}
