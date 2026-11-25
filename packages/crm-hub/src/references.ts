import type { CrmEntityType, CrmProviderKey, ParsedCrmReference } from "@sci/contracts";

/**
 * Leitura de URL ou ID do registro informado manualmente.
 *
 * Cada CRM tem formato próprio — não assumir o mesmo entre eles.
 * Os padrões de URL abaixo seguem os formatos públicos conhecidos de cada produto e
 * DEVEM ser confirmados com contas reais antes de o CRM ser marcado como disponível
 * (`URL_PATTERNS_VERIFIED`). Informar o ID puro funciona sempre.
 */
export const URL_PATTERNS_VERIFIED: Record<CrmProviderKey, boolean> = {
  bitrix24: false,
  pipedrive: false,
  rdstation: false,
  zoho: false,
};

interface Rule {
  host: (h: string) => boolean;
  path: RegExp;
  entity: (m: RegExpMatchArray) => CrmEntityType | null;
  id: (m: RegExpMatchArray) => string;
  account: (u: URL, m: RegExpMatchArray) => string | null;
}

const RULES: Record<CrmProviderKey, Rule[]> = {
  // https://<portal>.bitrix24.com.br/crm/deal/details/123/
  bitrix24: [
    {
      host: (h) => /(^|\.)bitrix24\.[a-z.]+$/.test(h),
      path: /^\/crm\/(deal|company|contact|lead)\/details\/(\d+)\/?$/,
      entity: (m) => m[1] as CrmEntityType,
      id: (m) => m[2]!,
      account: (u) => u.hostname,
    },
  ],
  // https://<empresa>.pipedrive.com/deal/123 | /organization/45 | /person/67
  pipedrive: [
    {
      host: (h) => h.endsWith(".pipedrive.com"),
      path: /^\/(deal|organization|person|leads\/inbox)\/([\w-]+)\/?$/,
      entity: (m) =>
        ({ deal: "deal", organization: "company", person: "contact", "leads/inbox": "lead" })[
          m[1]!
        ] as CrmEntityType,
      id: (m) => m[2]!,
      account: (u) => u.hostname.split(".")[0] ?? null,
    },
  ],
  // https://crm.rdstation.com/app/deals/<24 hex> | /app/organizations/<id> | /app/contacts/<id>
  rdstation: [
    {
      host: (h) => h === "crm.rdstation.com" || h.endsWith(".rdstation.com"),
      path: /^\/app\/(deals|organizations|contacts)\/([0-9a-f]{24})\/?/i,
      entity: (m) =>
        ({ deals: "deal", organizations: "company", contacts: "contact" })[
          m[1]!.toLowerCase()
        ] as CrmEntityType,
      id: (m) => m[2]!.toLowerCase(),
      account: () => null,
    },
  ],
  // https://crm.zoho.com/crm/org<orgId>/tab/Potentials/<id> (Deals = Potentials)
  zoho: [
    {
      host: (h) => /^crm\.zoho\.[a-z.]+$/.test(h) || /^crm\.zohocloud\.[a-z.]+$/.test(h),
      path: /^\/crm\/(?:org(\d+)\/)?tab\/(Potentials|Accounts|Contacts|Leads)\/(\d+)/,
      entity: (m) =>
        ({ Potentials: "deal", Accounts: "company", Contacts: "contact", Leads: "lead" })[
          m[2]!
        ] as CrmEntityType,
      id: (m) => m[3]!,
      account: (u, m) => (m[1] ? `org${m[1]}` : u.hostname),
    },
  ],
};

/** Formatos de ID puro por CRM (sem URL). */
const ID_FORMATS: Record<CrmProviderKey, RegExp> = {
  bitrix24: /^\d{1,12}$/,
  pipedrive: /^\d{1,12}$/,
  rdstation: /^[0-9a-f]{24}$/i,
  zoho: /^\d{10,20}$/,
};

export class ReferenceError extends Error {}

export function parseCrmReference(
  provider: CrmProviderKey,
  input: string,
  entityType: CrmEntityType = "deal",
): ParsedCrmReference {
  const raw = input.trim();
  if (/^https?:\/\//i.test(raw)) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ReferenceError("URL inválida");
    }
    if (u.protocol !== "https:") throw new ReferenceError("Use o endereço https do CRM");
    for (const rule of RULES[provider]) {
      if (!rule.host(u.hostname.toLowerCase())) continue;
      const m = u.pathname.match(rule.path);
      if (!m) continue;
      const entity = rule.entity(m);
      if (!entity) continue;
      return {
        provider,
        entityType: entity,
        externalRecordId: rule.id(m),
        externalAccountId: rule.account(u, m),
        recordUrl: `${u.origin}${u.pathname}`,
        source: "url",
      };
    }
    throw new ReferenceError(
      "Não reconhecemos este endereço como um registro deste CRM. Confira o CRM selecionado ou informe apenas o ID.",
    );
  }
  if (!ID_FORMATS[provider].test(raw)) throw new ReferenceError("ID em formato inesperado para este CRM");
  return {
    provider,
    entityType,
    externalRecordId: raw.toLowerCase(),
    externalAccountId: null,
    recordUrl: null,
    source: "id",
  };
}
