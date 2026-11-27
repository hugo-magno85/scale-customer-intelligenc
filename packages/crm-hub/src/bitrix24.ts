import type { CrmEntityType, CrmRecordSnapshot } from "@sci/contracts";
import { CrmHttpError, RateLimiter } from "./http.js";
import type { CrmClient, CrmClientFactory } from "./providers.js";

/**
 * Bitrix24 via webhook de entrada (uma conta Bitrix24 por conexão).
 * Referência: documentação oficial da REST API (github.com/bitrix24/b24restdocs):
 *  - local-integrations/local-webhooks.md — URL https://<portal>/rest/<user_id>/<código>/<método>
 *  - _includes/system-errors.md — envelope { error, error_description } e códigos de sistema
 *  - limits.md — leaky bucket: bloqueio (503 QUERY_LIMIT_EXCEEDED) acima de 50, vazão de 2/s
 *  - crm.deal.get / crm.company.get / crm.contact.get / crm.lead.get / user.get / scope
 *  - crm.timeline.comment.add / tasks.task.add (UF_CRM_TASK: D_, L_, C_, CO_)
 * Só o Bitrix24 em nuvem (*.bitrix24.<tld>) é aceito: a URL do webhook é validada antes de qualquer
 * chamada para evitar que a API seja usada para acessar outros endereços.
 */

const HOST_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.bitrix24\.[a-z]{2,4}(\.[a-z]{2})?$/i;
const PATH_RE = /^\/rest\/(\d{1,10})\/([A-Za-z0-9]{6,64})\/?$/;

export interface BitrixWebhook {
  host: string;
  userId: string;
  base: string;
}

/** Valida a URL do webhook e confere com o portal informado. Nunca inclui o código secreto em mensagens. */
export function parseBitrixWebhook(secret: string, portal: string): BitrixWebhook {
  let u: URL;
  try {
    u = new URL(secret.trim());
  } catch {
    throw new CrmHttpError("Informe a URL completa do webhook de entrada do Bitrix24", null, false);
  }
  const host = u.hostname.toLowerCase();
  const m = u.pathname.match(PATH_RE);
  if (u.protocol !== "https:" || !HOST_RE.test(host) || !m || u.search || u.username || u.port)
    throw new CrmHttpError(
      "URL de webhook inválida. O formato esperado é https://SEUPORTAL.bitrix24.com.br/rest/ID/CÓDIGO/",
      null,
      false,
    );
  const expected = portal
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (expected !== host)
    throw new CrmHttpError(
      `A URL do webhook é de outro portal (${host}); a conexão foi registrada para ${expected}`,
      null,
      false,
    );
  return { host, userId: m[1]!, base: `https://${host}/rest/${m[1]}/${m[2]}/` };
}

/** Erros de negócio do Bitrix24 em mensagens claras (sem expor a URL). */
function describe(status: number, error: string, description: string): CrmHttpError {
  const e = error.toUpperCase();
  const d = description.toLowerCase().trim().replace(/\.$/, "");
  if (e === "INVALID_CREDENTIALS" || e === "NO_AUTH_FOUND")
    return new CrmHttpError(
      "Webhook do Bitrix24 não encontrado ou desativado. Gere um novo e atualize a conexão.",
      status,
      false,
    );
  if (e === "INSUFFICIENT_SCOPE" || e === "ERROR_METHOD_NOT_FOUND")
    return new CrmHttpError(
      "O webhook não tem a permissão necessária. Edite-o no Bitrix24 e marque CRM (crm), Tarefas (task) e Usuários (user).",
      status,
      false,
    );
  if (e === "ACCESS_DENIED" && d.includes("subscription"))
    return new CrmHttpError("A REST API não está liberada no plano atual do Bitrix24.", status, false);
  if (e === "OVERLOAD_LIMIT" || e === "PORTAL_DELETED")
    return new CrmHttpError(`O Bitrix24 bloqueou o acesso REST (${error}).`, status, false);
  if (d === "not found") return new CrmHttpError("Registro não encontrado no Bitrix24", 404, false);
  if (d === "access denied" || e === "ACCESS_DENIED")
    return new CrmHttpError(
      "O usuário dono do webhook não tem permissão para acessar este registro no Bitrix24",
      403,
      false,
    );
  if (d.includes("id is not defined")) return new CrmHttpError("ID do registro inválido", 400, false);
  return new CrmHttpError(
    `Bitrix24 recusou a operação: ${error || "erro"}${description ? ` — ${description.slice(0, 200)}` : ""}`,
    status,
    false,
  );
}

const RETRYABLE = new Set([
  "QUERY_LIMIT_EXCEEDED",
  "INTERNAL_SERVER_ERROR",
  "ERROR_UNEXPECTED_ANSWER",
  "BITRIX_REST_V3_EXCEPTION_LIMITER_QUERYTIMELIMITEXCEPTION",
]);

export interface BitrixOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  limiter?: RateLimiter;
  maxRetries?: number;
}

/** Um limitador por portal: o Bitrix24 conta as requisições por IP de origem + portal. */
const limiters = new Map<string, RateLimiter>();
/** Campos já conferidos por portal (evita listar a cada envio). */
const ensuredFields = new Map<string, Set<string>>();

/** Campos personalizados do negócio criados pela plataforma (prefixo UF_CRM_ é do Bitrix). */
export const BITRIX_SUMMARY_FIELDS = [
  { name: "SCI_HEALTH", type: "double", label: "Customer Health (Scale) 0–10" },
  { name: "SCI_RISK", type: "string", label: "Risco de churn (Scale)" },
  { name: "SCI_LAST_ANALYSIS", type: "datetime", label: "Última análise (Scale)" },
] as const;
const limiterFor = (host: string) => {
  let l = limiters.get(host);
  if (!l) limiters.set(host, (l = new RateLimiter(2, 10)));
  return l;
};

export function createBitrixClient(
  webhook: BitrixWebhook,
  o: BitrixOptions = {},
): CrmClient & {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
} {
  const f = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const limiter = o.limiter ?? limiterFor(webhook.host);
  const max = o.maxRetries ?? 3;

  async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    let last: CrmHttpError | null = null;
    for (let attempt = 0; attempt <= max; attempt++) {
      await limiter.take();
      let res: Response;
      try {
        res = await f(webhook.base + method, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(params),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        last = new CrmHttpError("Falha de conexão com o Bitrix24", null, true);
        if (attempt < max) await sleep(Math.min(8000, 500 * 2 ** attempt));
        continue;
      }
      let body: { result?: T; error?: string; error_description?: string } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        /* resposta sem JSON */
      }
      if (res.ok && !body.error) return body.result as T;
      const code = body.error ?? "";
      const retryable = RETRYABLE.has(code.toUpperCase()) || res.status === 429 || res.status >= 500;
      last = retryable
        ? new CrmHttpError(
            code === "QUERY_LIMIT_EXCEEDED"
              ? "Limite de requisições do Bitrix24 atingido; tente novamente em instantes"
              : `Bitrix24 indisponível no momento (HTTP ${res.status})`,
            res.status,
            true,
          )
        : describe(res.status, code, body.error_description ?? "");
      // Bloqueio por tempo de execução dura 5 minutos: não adianta insistir.
      if (!retryable || code === "OPERATION_TIME_LIMIT" || attempt === max) break;
      const ra = Number(res.headers.get("retry-after"));
      await sleep(
        Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : Math.min(8000, 1000 * 2 ** attempt),
      );
    }
    throw last ?? new CrmHttpError("Falha desconhecida no Bitrix24", null, false);
  }

  const url = (t: CrmEntityType, id: string) => `https://${webhook.host}/crm/${t}/details/${id}/`;
  const fullName = (r: { NAME?: string | null; LAST_NAME?: string | null }) =>
    [r.NAME, r.LAST_NAME]
      .filter((x) => x && String(x).trim())
      .join(" ")
      .trim();
  const firstEmail = (r: { EMAIL?: { VALUE?: string }[] }) => r.EMAIL?.find((e) => e.VALUE)?.VALUE ?? null;
  const positive = (v: unknown) => (v && String(v) !== "0" ? String(v) : null);

  async function owner(id: unknown): Promise<CrmRecordSnapshot["owner"]> {
    const oid = positive(id);
    if (!oid) return null;
    try {
      const users = await call<{ ID: string; NAME?: string; LAST_NAME?: string }[]>("user.get", {
        filter: { ID: oid },
        select: ["ID", "NAME", "LAST_NAME"],
      });
      const u = users?.[0];
      return { id: oid, name: (u && fullName(u)) || `Usuário ${oid}` };
    } catch {
      // Sem permissão "user" no webhook: mantém o ID do responsável
      return { id: oid, name: `Usuário ${oid}` };
    }
  }
  async function company(id: unknown): Promise<CrmRecordSnapshot["company"]> {
    const cid = positive(id);
    if (!cid) return null;
    const c = await call<{ ID: string; TITLE: string }>("crm.company.get", { id: cid });
    return { id: String(c.ID), name: c.TITLE };
  }
  async function contact(id: unknown): Promise<CrmRecordSnapshot["contact"]> {
    const cid = positive(id);
    if (!cid) return null;
    const c = await call<{ ID: string; NAME?: string; LAST_NAME?: string; EMAIL?: { VALUE?: string }[] }>(
      "crm.contact.get",
      { id: cid },
    );
    return { id: String(c.ID), name: fullName(c) || `Contato ${cid}`, email: firstEmail(c) };
  }
  const checkId = (id: string) => {
    if (!/^\d{1,12}$/.test(id)) throw new CrmHttpError("ID do registro inválido", 400, false);
  };
  const OWNER_PREFIX: Record<CrmEntityType, string> = { deal: "D", lead: "L", contact: "C", company: "CO" };

  return {
    call,
    async validateConnection() {
      const scopes = await call<string[]>("scope");
      if (!Array.isArray(scopes) || !scopes.includes("crm"))
        throw new CrmHttpError(
          "O webhook não tem a permissão CRM (crm). Edite-o no Bitrix24 e marque CRM.",
          null,
          false,
        );
      return { accountName: webhook.host };
    },

    async getRecord(entityType, externalId) {
      checkId(externalId);
      if (entityType === "deal") {
        const d = await call<Record<string, string | null>>("crm.deal.get", { id: externalId });
        return {
          deal: { id: String(d.ID), title: d.TITLE ?? `Negócio ${externalId}`, stage: d.STAGE_ID ?? null },
          company: await company(d.COMPANY_ID),
          contact: await contact(d.CONTACT_ID),
          owner: await owner(d.ASSIGNED_BY_ID),
          recordUrl: url("deal", externalId),
        };
      }
      if (entityType === "company") {
        const c = await call<Record<string, string | null>>("crm.company.get", { id: externalId });
        return {
          deal: null,
          company: { id: String(c.ID), name: c.TITLE ?? `Empresa ${externalId}` },
          contact: null,
          owner: await owner(c.ASSIGNED_BY_ID),
          recordUrl: url("company", externalId),
        };
      }
      if (entityType === "contact") {
        const c = await call<Record<string, unknown>>("crm.contact.get", { id: externalId });
        return {
          deal: null,
          company: await company(c.COMPANY_ID),
          contact: {
            id: String(c.ID),
            name: fullName(c as { NAME?: string; LAST_NAME?: string }) || `Contato ${externalId}`,
            email: firstEmail(c as { EMAIL?: { VALUE?: string }[] }),
          },
          owner: await owner(c.ASSIGNED_BY_ID),
          recordUrl: url("contact", externalId),
        };
      }
      const l = await call<Record<string, unknown>>("crm.lead.get", { id: externalId });
      const person = fullName(l as { NAME?: string; LAST_NAME?: string });
      return {
        deal: {
          id: String(l.ID),
          title: `Lead: ${String(l.TITLE ?? externalId)}`,
          stage: (l.STATUS_ID as string) ?? null,
        },
        company: await company(l.COMPANY_ID),
        contact: person
          ? {
              id: String(l.CONTACT_ID ?? l.ID),
              name: person,
              email: firstEmail(l as { EMAIL?: { VALUE?: string }[] }),
            }
          : await contact(l.CONTACT_ID),
        owner: await owner(l.ASSIGNED_BY_ID),
        recordUrl: url("lead", externalId),
      };
    },

    // Escrita no CRM: só é chamada pelo fluxo de publicação com aprovação (integration_syncs faz a idempotência).
    async publishNote(entityType, externalId, note) {
      checkId(externalId);
      const id = await call<number>("crm.timeline.comment.add", {
        fields: {
          ENTITY_ID: Number(externalId),
          ENTITY_TYPE: entityType,
          COMMENT: `${note.title}\n\n${note.body}`,
        },
      });
      return { externalNoteId: String(id) };
    },

    async updateSummaryFields(entityType, externalId, values) {
      checkId(externalId);
      if (entityType !== "deal")
        return { fields: [], warnings: ["Campos de resumo são gravados apenas em negócios (deal)"] };
      const warnings: string[] = [];
      const known = ensuredFields.get(webhook.host) ?? new Set<string>();
      for (const f of BITRIX_SUMMARY_FIELDS) {
        const full = `UF_CRM_${f.name}`;
        if (known.has(full)) continue;
        try {
          const found = await call<{ FIELD_NAME: string }[]>("crm.deal.userfield.list", {
            filter: { FIELD_NAME: full },
          });
          if (!found?.some((x) => x.FIELD_NAME === full))
            await call<number>("crm.deal.userfield.add", {
              fields: {
                FIELD_NAME: f.name,
                USER_TYPE_ID: f.type,
                LABEL: f.label,
                SHOW_FILTER: "Y",
                EDIT_IN_LIST: "N",
              },
            });
          known.add(full);
        } catch (e) {
          warnings.push(
            /permissão|access denied/i.test((e as Error).message)
              ? "Campos personalizados não criados: o usuário do webhook precisa da permissão de configurar o CRM. Crie-os uma vez com um administrador ou ajuste a permissão."
              : `Campo ${full} indisponível: ${(e as Error).message}`,
          );
        }
      }
      ensuredFields.set(webhook.host, known);
      const fields: Record<string, unknown> = {};
      if (known.has("UF_CRM_SCI_HEALTH") && values.healthScore10 !== null)
        fields.UF_CRM_SCI_HEALTH = values.healthScore10;
      if (known.has("UF_CRM_SCI_RISK") && values.riskLabel !== null)
        fields.UF_CRM_SCI_RISK = values.riskLabel;
      if (known.has("UF_CRM_SCI_LAST_ANALYSIS")) fields.UF_CRM_SCI_LAST_ANALYSIS = values.analyzedAt;
      if (!Object.keys(fields).length) return { fields: [], warnings: [...new Set(warnings)] };
      await call<boolean>("crm.deal.update", {
        id: externalId,
        fields,
        params: { REGISTER_SONET_EVENT: "N" },
      });
      return { fields: Object.keys(fields), warnings: [...new Set(warnings)] };
    },

    async createTask(entityType, externalId, task) {
      checkId(externalId);
      const r = await call<{ task: { id: string } }>("tasks.task.add", {
        fields: {
          TITLE: task.title,
          ...(task.description ? { DESCRIPTION: task.description } : {}),
          RESPONSIBLE_ID: Number(task.ownerExternalId ?? webhook.userId),
          ...(task.dueDate ? { DEADLINE: `${task.dueDate}T18:00:00` } : {}),
          UF_CRM_TASK: [`${OWNER_PREFIX[entityType]}_${externalId}`],
        },
      });
      return { externalTaskId: String(r.task.id) };
    },
  };
}

export const bitrixFactory: CrmClientFactory = ({ externalAccountId, secret, authType }) => {
  if (authType !== "webhook")
    throw new CrmHttpError("No momento o Bitrix24 funciona com webhook de entrada", null, false);
  return createBitrixClient(parseBitrixWebhook(secret, externalAccountId));
};
