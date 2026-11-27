import { z } from "zod";
import { Uuid } from "./common.js";

export const CRM_PROVIDERS = ["bitrix24", "pipedrive", "rdstation", "zoho"] as const;
export const CrmProviderKey = z.enum(CRM_PROVIDERS);
export type CrmProviderKey = z.infer<typeof CrmProviderKey>;

export const CRM_LABELS: Record<CrmProviderKey, string> = {
  bitrix24: "Bitrix24",
  pipedrive: "Pipedrive",
  rdstation: "RD Station CRM",
  zoho: "Zoho CRM",
};

export const CrmEntityType = z.enum(["deal", "company", "contact", "lead"]);
export type CrmEntityType = z.infer<typeof CrmEntityType>;
export const CRM_ENTITY_LABELS: Record<CrmEntityType, string> = {
  deal: "Negócio / Deal / Card",
  company: "Empresa",
  contact: "Contato",
  lead: "Lead",
};

/** Situação de cada CRM no produto. Só "available" após autenticação, consulta real, validação e testes. */
export const CrmProviderStatus = z.enum(["awaiting_credentials", "homologation", "available"]);

export const CrmProviderInfo = z.object({
  key: CrmProviderKey,
  label: z.string(),
  status: CrmProviderStatus,
  authTypes: z.array(z.enum(["oauth", "api_token", "webhook"])),
  entityTypes: z.array(CrmEntityType),
  referenceHint: z.string(),
});
export type CrmProviderInfo = z.infer<typeof CrmProviderInfo>;

/** O que enviar ao CRM depois da análise de uma reunião vinculada. */
export const CrmConnectionSettings = z.object({
  /** Envia sozinho assim que a análise termina (sem aprovação a cada reunião). */
  autoPublish: z.boolean().default(false),
  publishComment: z.boolean().default(true),
  publishTasks: z.boolean().default(true),
  publishFields: z.boolean().default(true),
});
export type CrmConnectionSettings = z.infer<typeof CrmConnectionSettings>;

export const CrmConnection = z.object({
  id: Uuid,
  provider: CrmProviderKey,
  label: z.string(),
  externalAccountId: z.string(),
  authType: z.enum(["oauth", "api_token", "webhook"]),
  status: z.enum(["pending", "active", "error", "disabled"]),
  hasCredentials: z.boolean(),
  lastValidatedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  settings: CrmConnectionSettings,
  createdAt: z.string(),
});
export type CrmConnection = z.infer<typeof CrmConnection>;

export const CreateCrmConnectionRequest = z.object({
  provider: CrmProviderKey,
  label: z.string().trim().min(2).max(120),
  externalAccountId: z.string().trim().min(1).max(255),
  authType: z.enum(["oauth", "api_token", "webhook"]),
  /** Token/segredo. Gravado cifrado; nunca devolvido. */
  secret: z.string().min(8).max(4000).optional(),
});

export const ParsedCrmReference = z.object({
  provider: CrmProviderKey,
  entityType: CrmEntityType,
  externalRecordId: z.string(),
  externalAccountId: z.string().nullable(),
  recordUrl: z.string().nullable(),
  source: z.enum(["url", "id"]),
});
export type ParsedCrmReference = z.infer<typeof ParsedCrmReference>;

export const CrmRecordSnapshot = z.object({
  company: z.object({ id: z.string(), name: z.string() }).nullable(),
  deal: z.object({ id: z.string(), title: z.string(), stage: z.string().nullable() }).nullable(),
  contact: z.object({ id: z.string(), name: z.string(), email: z.string().nullable() }).nullable(),
  owner: z.object({ id: z.string(), name: z.string() }).nullable(),
  recordUrl: z.string().nullable(),
});
export type CrmRecordSnapshot = z.infer<typeof CrmRecordSnapshot>;

export const MeetingCrmLink = z.object({
  id: Uuid,
  meetingId: Uuid,
  provider: CrmProviderKey,
  connectionId: Uuid.nullable(),
  externalAccountId: z.string().nullable(),
  entityType: CrmEntityType,
  externalRecordId: z.string(),
  recordUrl: z.string().nullable(),
  customerId: Uuid.nullable(),
  contactId: Uuid.nullable(),
  snapshot: CrmRecordSnapshot.nullable(),
  validationStatus: z.enum(["pending", "validated", "failed"]),
  validationError: z.string().nullable(),
  origin: z.enum(["automatic", "manual"]),
  userId: Uuid.nullable(),
  userName: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  replacedAt: z.string().nullable(),
});
export type MeetingCrmLink = z.infer<typeof MeetingCrmLink>;

export const LinkCrmRecordRequest = z.object({
  provider: CrmProviderKey,
  /** URL completa do registro ou ID. */
  reference: z.string().trim().min(1).max(1000),
  entityType: CrmEntityType.optional(),
  connectionId: Uuid.optional(),
});

/** Envio da análise ao CRM (um por análise × registro vinculado). */
export const CrmPublishSync = z.object({
  id: Uuid,
  provider: CrmProviderKey,
  status: z.enum(["pending", "running", "succeeded", "failed", "needs_approval", "cancelled"]),
  /** Origem: automática (após a análise) ou manual (botão). */
  trigger: z.enum(["auto", "manual"]),
  recordUrl: z.string().nullable(),
  noteId: z.string().nullable(),
  taskIds: z.array(z.string()),
  fieldsUpdated: z.array(z.string()),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  analysisId: Uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CrmPublishSync = z.infer<typeof CrmPublishSync>;
