import type { CrmEntityType, CrmRecordSnapshot } from "@sci/contracts";
import { CrmHttpError, RateLimiter } from "./http.js";
import type { CrmClient, CrmClientFactory } from "./providers.js";

/**
 * Pipedrive por token de API pessoal (uma empresa Pipedrive por conexão).
 * Referência: cliente oficial github.com/pipedrive/client-nodejs (gerado da especificação OpenAPI):
 *  - autenticação: cabeçalho `x-api-token`; hosts fixos api.pipedrive.com/v1 e /api/v2
 *  - v1: GET /users/me (company_domain), GET /users/{id}, GET /leads/{id}, POST /notes
 *  - v2: GET /deals/{id}, /organizations/{id}, /persons/{id}; PATCH /deals/{id} (custom_fields);
 *        POST /activities; GET|POST /dealFields (field_code)
 * O host é fixo: o token nunca é enviado a outro endereço.
 */
const V1 = "https://api.pipedrive.com/v1";
const V2 = "https://api.pipedrive.com/api/v2";

export interface PipedriveOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  limiter?: RateLimiter;
  maxRetries?: number;
}

/** Campos personalizados do negócio criados pela plataforma (identificados pelo nome). */
export const PIPEDRIVE_SUMMARY_FIELDS = [
  { key: "health", name: "Customer Health (Scale) 0–10", type: "double" },
  { key: "risk", name: "Risco de churn (Scale)", type: "varchar" },
  { key: "last", name: "Última análise (Scale)", type: "date" },
] as const;

const fieldCodes = new Map<string, Record<string, string>>();
const limiters = new Map<string, RateLimiter>();

/** Conta = subdomínio da empresa (ex.: "acme" de acme.pipedrive.com). */
export function normalizePipedriveAccount(account: string): string {
  return account
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.pipedrive\.com$/, "");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function createPipedriveClient(
  account: string,
  token: string,
  o: PipedriveOptions = {},
): CrmClient & { call<T>(base: "v1" | "v2", method: string, path: string, body?: unknown): Promise<T> } {
  const company = normalizePipedriveAccount(account);
  const f = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  // Limite do Pipedrive é por token (janela de 2 s); 5/s com folga de rajada fica bem abaixo.
  const limiter = o.limiter ?? limiters.get(company) ?? new RateLimiter(5, 10);
  limiters.set(company, limiter);
  const max = o.maxRetries ?? 3;

  async function call<T>(base: "v1" | "v2", method: string, path: string, body?: unknown): Promise<T> {
    let last: CrmHttpError | null = null;
    for (let attempt = 0; attempt <= max; attempt++) {
      await limiter.take();
      let res: Response;
      try {
        res = await f(`${base === "v1" ? V1 : V2}${path}`, {
          method,
          headers: {
            accept: "application/json",
            "x-api-token": token,
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        last = new CrmHttpError("Falha de conexão com o Pipedrive", null, true);
        if (attempt < max) await sleep(Math.min(8000, 500 * 2 ** attempt));
        continue;
      }
      let json: { success?: boolean; data?: T; error?: string; error_info?: string } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        /* sem JSON */
      }
      if (res.ok && json.success !== false) return json.data as T;
      const retryable = res.status === 429 || res.status >= 500;
      const msg =
        res.status === 401
          ? "Token do Pipedrive inválido ou revogado. Gere outro em Configurações pessoais → API."
          : res.status === 403
            ? "O usuário do token não tem permissão para esta operação no Pipedrive"
            : res.status === 404
              ? "Registro não encontrado no Pipedrive"
              : res.status === 402
                ? "O plano do Pipedrive não permite esta operação"
                : retryable
                  ? res.status === 429
                    ? "Limite de requisições do Pipedrive atingido; tente novamente em instantes"
                    : `Pipedrive indisponível no momento (HTTP ${res.status})`
                  : `Pipedrive recusou a operação${json.error ? `: ${String(json.error).slice(0, 200)}` : ` (HTTP ${res.status})`}`;
      last = new CrmHttpError(msg, res.status, retryable);
      if (!retryable || attempt === max) break;
      const ra = Number(res.headers.get("retry-after"));
      await sleep(
        Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : Math.min(8000, 1000 * 2 ** attempt),
      );
    }
    throw last ?? new CrmHttpError("Falha desconhecida no Pipedrive", null, false);
  }

  const urlOf = (t: CrmEntityType, id: string) =>
    `https://${company}.pipedrive.com/${t === "deal" ? "deal" : t === "company" ? "organization" : t === "contact" ? "person" : "leads/inbox"}/${id}`;
  const checkId = (t: CrmEntityType, id: string) => {
    const ok = t === "lead" ? /^[0-9a-f-]{36}$/i.test(id) : /^\d{1,12}$/.test(id);
    if (!ok) throw new CrmHttpError("ID do registro inválido", 400, false);
  };
  const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { value?: unknown }).value : v);
  const positive = (v: unknown) => {
    const x = idOf(v);
    return x && String(x) !== "0" ? String(x) : null;
  };

  async function owner(id: unknown): Promise<CrmRecordSnapshot["owner"]> {
    const oid = positive(id);
    if (!oid) return null;
    try {
      const u = await call<{ id: number; name: string }>("v1", "GET", `/users/${oid}`);
      return { id: oid, name: u?.name || `Usuário ${oid}` };
    } catch {
      return { id: oid, name: `Usuário ${oid}` };
    }
  }
  async function org(id: unknown): Promise<CrmRecordSnapshot["company"]> {
    const oid = positive(id);
    if (!oid) return null;
    const x = await call<{ id: number; name: string }>("v2", "GET", `/organizations/${oid}`);
    return { id: String(x.id), name: x.name };
  }
  async function person(id: unknown): Promise<CrmRecordSnapshot["contact"]> {
    const pid = positive(id);
    if (!pid) return null;
    const p = await call<{ id: number; name: string; emails?: { value: string; primary?: boolean }[] }>(
      "v2",
      "GET",
      `/persons/${pid}`,
    );
    const email = p.emails?.find((e) => e.primary)?.value ?? p.emails?.[0]?.value ?? null;
    return { id: String(p.id), name: p.name || `Pessoa ${pid}`, email };
  }
  /** Vínculo do registro em notas e atividades. */
  const target = (t: CrmEntityType, id: string) =>
    t === "deal"
      ? { deal_id: Number(id) }
      : t === "lead"
        ? { lead_id: id }
        : t === "company"
          ? { org_id: Number(id) }
          : { person_id: Number(id) };

  return {
    call,
    async validateConnection() {
      const me = await call<{ name: string; company_domain?: string; company_name?: string }>(
        "v1",
        "GET",
        "/users/me",
      );
      if (me?.company_domain && me.company_domain.toLowerCase() !== company)
        throw new CrmHttpError(
          `O token é da empresa "${me.company_domain}", mas a conexão foi registrada para "${company}"`,
          null,
          false,
        );
      return { accountName: me?.company_name || company };
    },

    async getRecord(entityType, externalId) {
      checkId(entityType, externalId);
      if (entityType === "deal") {
        const d = await call<{
          id: number;
          title: string;
          stage_id?: number;
          org_id?: number;
          person_id?: number;
          owner_id?: number;
        }>("v2", "GET", `/deals/${externalId}`);
        return {
          deal: {
            id: String(d.id),
            title: d.title,
            stage: d.stage_id != null ? `Etapa ${d.stage_id}` : null,
          },
          company: await org(d.org_id),
          contact: await person(d.person_id),
          owner: await owner(d.owner_id),
          recordUrl: urlOf("deal", externalId),
        };
      }
      if (entityType === "company") {
        const c = await call<{ id: number; name: string; owner_id?: number }>(
          "v2",
          "GET",
          `/organizations/${externalId}`,
        );
        return {
          deal: null,
          company: { id: String(c.id), name: c.name },
          contact: null,
          owner: await owner(c.owner_id),
          recordUrl: urlOf("company", externalId),
        };
      }
      if (entityType === "contact") {
        const p = await call<{
          id: number;
          name: string;
          org_id?: number;
          owner_id?: number;
          emails?: { value: string; primary?: boolean }[];
        }>("v2", "GET", `/persons/${externalId}`);
        return {
          deal: null,
          company: await org(p.org_id),
          contact: {
            id: String(p.id),
            name: p.name,
            email: p.emails?.find((e) => e.primary)?.value ?? p.emails?.[0]?.value ?? null,
          },
          owner: await owner(p.owner_id),
          recordUrl: urlOf("contact", externalId),
        };
      }
      const l = await call<{
        id: string;
        title: string;
        person_id?: number;
        organization_id?: number;
        owner_id?: number;
      }>("v1", "GET", `/leads/${externalId}`);
      return {
        deal: { id: l.id, title: `Lead: ${l.title}`, stage: null },
        company: await org(l.organization_id),
        contact: await person(l.person_id),
        owner: await owner(l.owner_id),
        recordUrl: urlOf("lead", externalId),
      };
    },

    // Escrita: só pelo fluxo de envio da análise (integration_syncs controla a idempotência).
    async publishNote(entityType, externalId, note) {
      checkId(entityType, externalId);
      const html = `<b>${escapeHtml(note.title)}</b><br><br>${escapeHtml(note.body).replace(/\n/g, "<br>")}`;
      const n = await call<{ id: number }>("v1", "POST", "/notes", {
        content: html,
        ...target(entityType, externalId),
      });
      return { externalNoteId: String(n.id) };
    },

    async createTask(entityType, externalId, task) {
      checkId(entityType, externalId);
      const a = await call<{ id: number }>("v2", "POST", "/activities", {
        subject: task.title.slice(0, 250),
        type: "task",
        ...(entityType === "contact"
          ? { participants: [{ person_id: Number(externalId), primary: true }] }
          : target(entityType, externalId)),
        ...(task.dueDate ? { due_date: task.dueDate } : {}),
        ...(task.ownerExternalId && /^\d+$/.test(task.ownerExternalId)
          ? { owner_id: Number(task.ownerExternalId) }
          : {}),
        ...(task.description ? { note: escapeHtml(task.description) } : {}),
      });
      return { externalTaskId: String(a.id) };
    },

    async updateSummaryFields(entityType, externalId, values) {
      checkId(entityType, externalId);
      if (entityType !== "deal")
        return { fields: [], warnings: ["Campos de resumo são gravados apenas em negócios (deal)"] };
      const warnings: string[] = [];
      let codes = fieldCodes.get(company);
      if (!codes || PIPEDRIVE_SUMMARY_FIELDS.some((x) => !codes![x.key])) {
        codes = { ...(codes ?? {}) };
        // A API v2 de campos não está liberada em todas as contas: em falha (exceto permissão), usa a v1.
        // O `key` da v1 é o mesmo código usado em `custom_fields` no PATCH /api/v2/deals/{id}.
        const isPermission = (e: unknown) => (e as CrmHttpError).status === 403;
        const listFields = async (): Promise<{ code: string; name: string }[]> => {
          try {
            const v2 = await call<{ field_code: string; field_name: string }[]>(
              "v2",
              "GET",
              "/dealFields?limit=500",
            );
            return (v2 ?? []).map((d) => ({ code: d.field_code, name: d.field_name }));
          } catch (e) {
            if (isPermission(e)) throw e;
            const v1 = await call<{ key: string; name: string }[]>("v1", "GET", "/dealFields?limit=500");
            return (v1 ?? []).map((d) => ({ code: d.key, name: d.name }));
          }
        };
        const createField = async (x: (typeof PIPEDRIVE_SUMMARY_FIELDS)[number]): Promise<string> => {
          try {
            return (
              await call<{ field_code: string }>("v2", "POST", "/dealFields", {
                field_name: x.name,
                field_type: x.type,
              })
            ).field_code;
          } catch (e) {
            if (isPermission(e)) throw e;
            return (
              await call<{ key: string }>("v1", "POST", "/dealFields", { name: x.name, field_type: x.type })
            ).key;
          }
        };
        try {
          const all = await listFields();
          for (const x of PIPEDRIVE_SUMMARY_FIELDS) {
            const found = all.find((d) => d.name === x.name);
            if (found) codes[x.key] = found.code;
          }
          for (const x of PIPEDRIVE_SUMMARY_FIELDS) {
            if (codes[x.key]) continue;
            try {
              codes[x.key] = await createField(x);
            } catch (e) {
              warnings.push(
                /permissão|403/i.test((e as Error).message)
                  ? "Campos personalizados não criados: o usuário do token precisa ser administrador da empresa no Pipedrive (ou crie os campos uma vez com um administrador)."
                  : `Campo "${x.name}" indisponível: ${(e as Error).message}`,
              );
            }
          }
        } catch (e) {
          warnings.push(`Campos personalizados indisponíveis: ${(e as Error).message}`);
        }
        fieldCodes.set(company, codes);
      }
      const custom: Record<string, unknown> = {};
      if (codes.health && values.healthScore10 !== null) custom[codes.health] = values.healthScore10;
      if (codes.risk && values.riskLabel !== null) custom[codes.risk] = values.riskLabel;
      if (codes.last) custom[codes.last] = values.analyzedAt.slice(0, 10);
      if (!Object.keys(custom).length) return { fields: [], warnings: [...new Set(warnings)] };
      await call("v2", "PATCH", `/deals/${externalId}`, { custom_fields: custom });
      return {
        fields: PIPEDRIVE_SUMMARY_FIELDS.filter(
          (x) => codes![x.key] && custom[codes![x.key]!] !== undefined,
        ).map((x) => x.name),
        warnings: [...new Set(warnings)],
      };
    },
  };
}

export const pipedriveFactory: CrmClientFactory = ({ externalAccountId, secret, authType }) => {
  if (authType !== "api_token")
    throw new CrmHttpError("No momento o Pipedrive funciona com o token de API pessoal", null, false);
  return createPipedriveClient(externalAccountId, secret.trim());
};

/** Formato do token antes de gravar (sem chamar o Pipedrive). */
export function pipedriveCredentialError(authType: string, secret: string): string | null {
  if (authType !== "api_token") return "No momento o Pipedrive funciona com o token de API pessoal";
  return /^[A-Za-z0-9]{20,64}$/.test(secret.trim())
    ? null
    : "Token do Pipedrive inválido. Copie o “token de API pessoal” em Configurações pessoais → API.";
}
