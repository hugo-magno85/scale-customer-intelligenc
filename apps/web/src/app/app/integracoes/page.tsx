"use client";

import { CRM_LABELS, type CrmConnection, type CrmProviderInfo, type CrmProviderKey } from "@sci/contracts";
import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const CONN_STATUS = {
  pending: "Aguardando validação",
  active: "Ativa",
  error: "Com erro",
  disabled: "Desativada",
} as const;

export default function IntegrationsPage() {
  const { can } = useSession();
  const providers = useApi<CrmProviderInfo[]>("/crm/providers");
  const conns = useApi<CrmConnection[]>("/crm/connections");
  const [adding, setAdding] = useState<CrmProviderKey | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/crm/connections", {
        method: "POST",
        json: {
          provider: adding,
          label: f.get("label"),
          externalAccountId: f.get("account"),
          authType: f.get("authType"),
          secret: f.get("secret") || undefined,
        },
      });
      setAdding(null);
      setMsg({
        ok: true,
        text: "Conexão registrada. A credencial foi guardada cifrada e não será exibida novamente.",
      });
      await conns.reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }
  async function act(id: string, path: string, json?: object) {
    try {
      await api(`/crm/connections/${id}${path}`, { method: path ? "POST" : "PATCH", json });
      setMsg(null);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    await conns.reload();
  }

  const p = providers.data?.find((x) => x.key === adding);
  return (
    <>
      <PageHeader
        title="Integrações"
        subtitle="CRMs usados para contexto do cliente e para receber a inteligência gerada nas reuniões. O histórico completo permanece no Scale."
      />
      {msg && (
        <div className="mb-4">
          {msg.ok ? <p className="text-sm text-healthy">{msg.text}</p> : <ErrorText>{msg.text}</ErrorText>}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {providers.data?.map((pr) => (
          <Card key={pr.key} className="flex flex-col justify-between gap-3">
            <div>
              <div className="font-semibold">{pr.label}</div>
              <div
                className={`mt-1 text-xs ${pr.status === "available" ? "text-healthy" : pr.status === "homologation" ? "text-brand" : "text-attention"}`}
              >
                {pr.status === "available"
                  ? "Integração disponível"
                  : pr.status === "homologation"
                    ? "Em homologação — já conecta e consulta registros"
                    : "Aguardando homologação com conta real"}
              </div>
              <p className="mt-2 text-xs text-ink-soft">Vínculo manual: {pr.referenceHint}</p>
            </div>
            {can("integrations.manage") && (
              <Button variant="ghost" onClick={() => setAdding(pr.key)}>
                Registrar conta
              </Button>
            )}
          </Card>
        ))}
      </div>

      {adding && p && (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Registrar conta do {CRM_LABELS[adding]}</h2>
          <form onSubmit={add} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="Nome da conexão"
              name="label"
              required
              minLength={2}
              placeholder="Ex.: CRM comercial"
            />
            <Input
              label="Identificação da conta"
              name="account"
              required
              placeholder={
                adding === "bitrix24"
                  ? "suaempresa.bitrix24.com.br"
                  : adding === "pipedrive"
                    ? "suaempresa"
                    : adding === "zoho"
                      ? "org123456"
                      : "nome da conta"
              }
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Tipo de acesso</span>
              <select name="authType" className="w-full rounded-lg border border-line px-3 py-2">
                {p.authTypes.map((t) => (
                  <option key={t} value={t}>
                    {t === "oauth"
                      ? "OAuth (recomendado)"
                      : t === "api_token"
                        ? "Token de API"
                        : "Webhook de entrada"}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label={
                adding === "bitrix24"
                  ? "URL do webhook de entrada"
                  : adding === "pipedrive"
                    ? "Token de API pessoal"
                    : "Credencial (opcional agora)"
              }
              name="secret"
              type="password"
              autoComplete="off"
              minLength={8}
              required={adding === "bitrix24" || adding === "pipedrive"}
              placeholder={adding === "bitrix24" ? "https://suaempresa.bitrix24.com.br/rest/1/…/" : undefined}
            />
            {adding === "bitrix24" && (
              <p className="text-xs text-ink-soft sm:col-span-2 lg:col-span-4">
                No Bitrix24: Recursos para desenvolvedores → Outros → Webhook de entrada, com as permissões
                CRM, Tarefas e Usuários. A URL fica guardada cifrada e não aparece de novo. Depois de salvar,
                clique em “Validar conexão”.
              </p>
            )}
            {adding === "pipedrive" && (
              <p className="text-xs text-ink-soft sm:col-span-2 lg:col-span-4">
                No Pipedrive: clique na sua foto → Configurações pessoais → API e copie o “token de API
                pessoal”. Em “Identificação da conta”, use o endereço da empresa (ex.: suaempresa de
                suaempresa.pipedrive.com). O token fica guardado cifrado e não aparece de novo. Depois de
                salvar, clique em “Validar conexão”.
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit">Salvar conexão</Button>
              <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Contas conectadas</h2>
      {conns.data?.length === 0 && <p className="text-sm text-ink-soft">Nenhuma conta registrada.</p>}
      <div className="space-y-2">
        {conns.data?.map((c) => (
          <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">
                {c.label}{" "}
                <span className="text-sm text-ink-soft">
                  · {CRM_LABELS[c.provider]} · {c.externalAccountId}
                </span>
              </div>
              <div className="text-xs text-ink-soft">
                {CONN_STATUS[c.status]} ·{" "}
                {c.hasCredentials ? "credencial guardada (cifrada)" : "sem credencial"}
                {c.lastValidatedAt
                  ? ` · validada em ${new Date(c.lastValidatedAt).toLocaleString("pt-BR")}`
                  : ""}
                {c.lastError ? ` · ${c.lastError}` : ""}
              </div>
              {can("integrations.manage") && (c.provider === "bitrix24" || c.provider === "pipedrive") && (
                <div className="mt-3 rounded-lg border border-line bg-canvas/60 p-3 text-sm">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={c.settings.autoPublish}
                      onChange={(e) => void act(c.id, "", { settings: { autoPublish: e.target.checked } })}
                    />
                    Enviar automaticamente ao CRM após a análise da reunião
                  </label>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-ink-soft">
                    {(
                      [
                        [
                          "publishComment",
                          c.provider === "pipedrive" ? "Nota com o resumo" : "Comentário com o resumo",
                        ],
                        ["publishTasks", c.provider === "pipedrive" ? "Atividades (tarefas)" : "Tarefas"],
                        ["publishFields", "Campos: Health, risco e data"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={c.settings[k]}
                          onChange={(e) => void act(c.id, "", { settings: { [k]: e.target.checked } })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {can("integrations.manage") && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => void act(c.id, "/validate")}>
                  Validar conexão
                </Button>
                {c.status !== "disabled" ? (
                  <Button variant="ghost" onClick={() => void act(c.id, "", { status: "disabled" })}>
                    Desativar
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => void act(c.id, "", { status: "pending" })}>
                    Reativar
                  </Button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
