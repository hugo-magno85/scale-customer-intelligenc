import {
  CRM_LABELS,
  CRM_PROVIDERS,
  type CrmProviderInfo,
  type CrmProviderKey,
  type CrmRecordSnapshot,
  type CrmEntityType,
} from "@sci/contracts";

/** Contrato que cada CRM implementa. Nenhuma implementação é registrada sem validação com conta real. */
export interface CrmClient {
  validateConnection(): Promise<{ accountName: string }>;
  getRecord(entityType: CrmEntityType, externalId: string): Promise<CrmRecordSnapshot>;
  publishNote(
    entityType: CrmEntityType,
    externalId: string,
    note: { title: string; body: string },
    idempotencyKey: string,
  ): Promise<{ externalNoteId: string }>;
  createTask(
    entityType: CrmEntityType,
    externalId: string,
    task: { title: string; dueDate: string | null; ownerExternalId: string | null },
    idempotencyKey: string,
  ): Promise<{ externalTaskId: string }>;
}

export interface CrmClientFactory {
  (args: {
    externalAccountId: string;
    secret: string;
    authType: "oauth" | "api_token" | "webhook";
  }): CrmClient;
}

const META: Record<CrmProviderKey, Omit<CrmProviderInfo, "key" | "label" | "status">> = {
  bitrix24: {
    // Webhook de entrada (uma conta Bitrix24). OAuth/Marketplace fica para quando houver app publicado.
    authTypes: ["webhook"],
    entityTypes: ["deal", "company", "contact", "lead"],
    referenceHint: "URL do negócio (…/crm/deal/details/123/) ou ID numérico",
  },
  pipedrive: {
    authTypes: ["oauth", "api_token"],
    entityTypes: ["deal", "company", "contact", "lead"],
    referenceHint: "URL do deal (…pipedrive.com/deal/123) ou ID numérico",
  },
  rdstation: {
    authTypes: ["oauth", "api_token"],
    entityTypes: ["deal", "company", "contact"],
    referenceHint: "URL da negociação (crm.rdstation.com/app/deals/…) ou ID de 24 caracteres",
  },
  zoho: {
    authTypes: ["oauth"],
    entityTypes: ["deal", "company", "contact", "lead"],
    referenceHint: "URL do negócio (…/tab/Potentials/…) ou ID numérico",
  },
};

/** Implementações homologadas. Vazio até cada CRM ser validado com conta e documentação oficial. */
const CLIENTS: Partial<Record<CrmProviderKey, CrmClientFactory>> = {};

/**
 * CRMs cujo cliente já passou por autenticação, consulta real, validação e testes com conta real.
 * Cliente registrado sem homologação aparece como "Em homologação": funciona, mas sem garantia.
 */
const HOMOLOGATED: Partial<Record<CrmProviderKey, true>> = {};

export function registerCrmClient(provider: CrmProviderKey, factory: CrmClientFactory) {
  CLIENTS[provider] = factory;
}

export function crmClientFactory(provider: CrmProviderKey): CrmClientFactory | null {
  return CLIENTS[provider] ?? null;
}

export function listProviders(): CrmProviderInfo[] {
  return CRM_PROVIDERS.map((key) => ({
    key,
    label: CRM_LABELS[key],
    status: !CLIENTS[key] ? "awaiting_credentials" : HOMOLOGATED[key] ? "available" : "homologation",
    ...META[key],
  }));
}
