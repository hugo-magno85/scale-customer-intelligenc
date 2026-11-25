import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  numeric,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Espelho tipado das tabelas criadas pelas migrations SQL.
 * As migrations são a fonte da verdade; o teste `schema-drift` garante
 * que estas definições batem com o banco migrado.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const tenants = pgTable("tenants", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: text("status", { enum: ["active", "suspended"] })
    .notNull()
    .default("active"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  kind: text("kind", { enum: ["web", "extension"] }).notNull(),
  userAgent: text("user_agent"),
  ip: inet("ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
});

export const roles = pgTable("roles", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  systemKey: text("system_key", { enum: ["tenant_admin", "manager", "cs", "analyst"] }),
  permissions: text("permissions")
    .array()
    .notNull()
    .default(sql`'{}'`),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const customers = pgTable("customers", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  segment: text("segment"),
  ownerUserId: uuid("owner_user_id"),
  relationshipStartedAt: date("relationship_started_at", { mode: "string" }),
  mrrCents: bigint("mrr_cents", { mode: "number" }),
  mrrSource: text("mrr_source", { enum: ["manual", "crm"] }),
  status: text("status", { enum: ["active", "churned", "paused"] })
    .notNull()
    .default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  jobTitle: text("job_title"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id"),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// --- 0003: playbooks e skill -------------------------------------------

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const csSkillVersions = pgTable("cs_skill_versions", {
  version: text("version").primaryKey(),
  contentHash: text("content_hash").notNull(),
  releasedAt: date("released_at", { mode: "string" }).notNull(),
  changelog: text("changelog")
    .array()
    .notNull()
    .default(sql`'{}'`),
  registeredAt: ts("registered_at").notNull().defaultNow(),
});

export const tenantSkillSettings = pgTable("tenant_skill_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const playbooks = pgTable("playbooks", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  meetingType: text("meeting_type").notNull(),
  journeyStage: text("journey_stage"),
  segment: text("segment"),
  operation: text("operation"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const playbookVersions = pgTable("playbook_versions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  playbookId: uuid("playbook_id").notNull(),
  number: integer("number").notNull(),
  status: text("status", {
    enum: ["processing", "failed", "draft", "in_review", "approved", "published", "archived"],
  }).notNull(),
  source: text("source", { enum: ["upload", "manual"] }).notNull(),
  structure: jsonb("structure").$type<unknown>(),
  processingError: text("processing_error"),
  processingWarnings: text("processing_warnings")
    .array()
    .notNull()
    .default(sql`'{}'`),
  interpretationModel: text("interpretation_model"),
  interpretationUsage: jsonb("interpretation_usage").$type<Record<string, unknown>>(),
  skillVersion: text("skill_version"),
  createdBy: uuid("created_by"),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
  publishedAt: ts("published_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const playbookDocuments = pgTable("playbook_documents", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  versionId: uuid("version_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  content: bytea("content").notNull(),
  extractedText: text("extracted_text"),
  extractedChars: integer("extracted_chars"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const playbookQuestions = pgTable("playbook_questions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  versionId: uuid("version_id").notNull(),
  key: text("key").notNull(),
  text: text("text").notNull(),
  type: text("type").notNull(),
  indicator: text("indicator"),
  priority: text("priority").notNull(),
  stageKey: text("stage_key"),
  weight: numeric("weight", { precision: 4, scale: 2, mode: "number" }).notNull(),
  required: boolean("required").notNull(),
  position: integer("position").notNull(),
});

export const playbookCriteria = pgTable("playbook_criteria", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  versionId: uuid("version_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  indicator: text("indicator"),
  weight: numeric("weight", { precision: 4, scale: 2, mode: "number" }).notNull(),
});

// --- 0004: reuniões -----------------------------------------------------
export const meetings = pgTable("meetings", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  ownerUserId: uuid("owner_user_id").notNull(),
  customerId: uuid("customer_id"),
  playbookVersionId: uuid("playbook_version_id"),
  skillVersion: text("skill_version"),
  platform: text("platform", { enum: ["google_meet", "zoom", "teams", "other"] }).notNull(),
  externalRef: text("external_ref"),
  title: text("title"),
  meetingType: text("meeting_type").notNull().default("other"),
  objective: text("objective"),
  status: text("status", { enum: ["preparing", "live", "ended", "analyzed"] })
    .notNull()
    .default("preparing"),
  consentMethod: text("consent_method", { enum: ["verbal_announcement", "written", "platform_notice"] }),
  consentConfirmedAt: ts("consent_confirmed_at"),
  consentConfirmedBy: uuid("consent_confirmed_by"),
  startedAt: ts("started_at"),
  endedAt: ts("ended_at"),
  checklist: jsonb("checklist").$type<unknown[]>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const meetingParticipants = pgTable("meeting_participants", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  role: text("role", { enum: ["internal", "customer", "unknown"] })
    .notNull()
    .default("unknown"),
  contactId: uuid("contact_id"),
  source: text("source", { enum: ["platform", "manual"] }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const meetingTranscriptSegments = pgTable("meeting_transcript_segments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  channel: integer("channel").notNull(),
  speaker: text("speaker", { enum: ["internal", "customer"] }).notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  text: text("text").notNull(),
  confidence: real("confidence"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const meetingStreamTickets = pgTable("meeting_stream_tickets", {
  tokenHash: text("token_hash").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  userId: uuid("user_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// --- 0005: inteligência em tempo real ------------------------------------
export const intelligenceSuggestions = pgTable("intelligence_suggestions", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  question: text("question").notNull(),
  reason: text("reason").notNull(),
  objective: text("objective").notNull(),
  type: text("type").notNull(),
  indicator: text("indicator"),
  priority: text("priority", { enum: ["high", "medium", "low"] }).notNull(),
  playbookQuestionKey: text("playbook_question_key"),
  candidateKey: text("candidate_key").notNull(),
  evidenceSegmentId: bigint("evidence_segment_id", { mode: "number" }),
  evidenceText: text("evidence_text"),
  evidenceSpeaker: text("evidence_speaker", { enum: ["internal", "customer"] }),
  status: text("status", { enum: ["shown", "done", "ignored", "replaced"] }).notNull(),
  adaptedBy: text("adapted_by"),
  createdAt: ts("created_at").notNull(),
  resolvedAt: ts("resolved_at"),
});

export const meetingLiveSignals = pgTable("meeting_live_signals", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  kind: text("kind", { enum: ["risk", "opportunity", "need"] }).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  confidence: real("confidence").notNull(),
  evidenceSegmentId: bigint("evidence_segment_id", { mode: "number" }),
  evidenceText: text("evidence_text").notNull(),
  evidenceSpeaker: text("evidence_speaker"),
  source: text("source", { enum: ["jev", "heuristic"] }).notNull(),
  createdAt: ts("created_at").notNull(),
});

export const meetingNotes = pgTable("meeting_notes", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  authorId: uuid("author_id"),
  suggestionId: uuid("suggestion_id"),
  text: text("text").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// --- 0006: Customer Intelligence -------------------------------------------
export const tenantHealthSettings = pgTable("tenant_health_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const meetingAnalyses = pgTable("meeting_analyses", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  version: integer("version").notNull(),
  status: text("status", { enum: ["processing", "completed", "failed"] }).notNull(),
  mode: text("mode", { enum: ["full", "basic"] }),
  summary: text("summary"),
  diagnosis: text("diagnosis"),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  warnings: text("warnings")
    .array()
    .notNull()
    .default(sql`'{}'`),
  error: text("error"),
  model: text("model"),
  skillVersion: text("skill_version"),
  playbookVersionId: uuid("playbook_version_id"),
  requestedBy: uuid("requested_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const intelligenceIndicators = pgTable("intelligence_indicators", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  analysisId: uuid("analysis_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  customerId: uuid("customer_id"),
  indicator: text("indicator").notNull(),
  score: real("score"),
  confidence: real("confidence"),
  rationale: text("rationale").notNull(),
  evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const customerHealthSnapshots = pgTable("customer_health_snapshots", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  meetingId: uuid("meeting_id"),
  analysisId: uuid("analysis_id"),
  score: real("score"),
  classification: text("classification", { enum: ["healthy", "attention", "high_risk"] }),
  factors: jsonb("factors").$type<unknown[]>().notNull().default([]),
  missing: text("missing")
    .array()
    .notNull()
    .default(sql`'{}'`),
  overrides: text("overrides")
    .array()
    .notNull()
    .default(sql`'{}'`),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const churnSignals = pgTable("churn_signals", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  factorKey: text("factor_key").notNull(),
  factorLabel: text("factor_label").notNull(),
  severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull(),
  recurrence: integer("recurrence").notNull().default(1),
  status: text("status", { enum: ["open", "monitoring", "resolved"] })
    .notNull()
    .default("open"),
  evidence: jsonb("evidence").$type<unknown[]>().notNull(),
  recommendation: text("recommendation").notNull(),
  nextAction: text("next_action"),
  revenueAtRiskCents: bigint("revenue_at_risk_cents", { mode: "number" }),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  lastMeetingId: uuid("last_meeting_id"),
  lastAnalysisId: uuid("last_analysis_id"),
});

export const expansionOpportunities = pgTable("expansion_opportunities", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  meetingId: uuid("meeting_id"),
  analysisId: uuid("analysis_id"),
  type: text("type").notNull(),
  typeLabel: text("type_label").notNull(),
  need: text("need").notNull(),
  evidence: jsonb("evidence").$type<unknown[]>().notNull(),
  potentialCents: bigint("potential_cents", { mode: "number" }),
  product: text("product"),
  nextAction: text("next_action"),
  ownerUserId: uuid("owner_user_id"),
  status: text("status", { enum: ["open", "qualified", "won", "lost", "discarded"] })
    .notNull()
    .default("open"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const actionPlans = pgTable("action_plans", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id"),
  meetingId: uuid("meeting_id"),
  analysisId: uuid("analysis_id"),
  title: text("title").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const actionTasks = pgTable("action_tasks", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  planId: uuid("plan_id"),
  customerId: uuid("customer_id"),
  meetingId: uuid("meeting_id"),
  title: text("title").notNull(),
  description: text("description"),
  ownerUserId: uuid("owner_user_id"),
  responsibleParty: text("responsible_party", { enum: ["internal", "customer"] })
    .notNull()
    .default("internal"),
  dueDate: date("due_date", { mode: "string" }),
  priority: text("priority", { enum: ["high", "medium", "low"] })
    .notNull()
    .default("medium"),
  status: text("status", { enum: ["pending", "in_progress", "done", "cancelled"] })
    .notNull()
    .default("pending"),
  evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
  recommendation: text("recommendation"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

// --- 0007: CRM Integration Hub ---------------------------------------------
export const crmConnections = pgTable("crm_connections", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  provider: text("provider", { enum: ["bitrix24", "pipedrive", "rdstation", "zoho"] }).notNull(),
  label: text("label").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  authType: text("auth_type", { enum: ["oauth", "api_token", "webhook"] }).notNull(),
  encryptedCredentials: text("encrypted_credentials"),
  status: text("status", { enum: ["pending", "active", "error", "disabled"] })
    .notNull()
    .default("pending"),
  lastValidatedAt: ts("last_validated_at"),
  lastError: text("last_error"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const meetingCrmLinks = pgTable("meeting_crm_links", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  connectionId: uuid("connection_id"),
  provider: text("provider", { enum: ["bitrix24", "pipedrive", "rdstation", "zoho"] }).notNull(),
  externalAccountId: text("external_account_id"),
  entityType: text("entity_type", { enum: ["deal", "company", "contact", "lead"] }).notNull(),
  externalRecordId: text("external_record_id").notNull(),
  recordUrl: text("record_url"),
  customerId: uuid("customer_id"),
  contactId: uuid("contact_id"),
  recordSnapshot: jsonb("record_snapshot").$type<Record<string, unknown>>(),
  validationStatus: text("validation_status", { enum: ["pending", "validated", "failed"] })
    .notNull()
    .default("pending"),
  validationError: text("validation_error"),
  validatedAt: ts("validated_at"),
  origin: text("origin", { enum: ["automatic", "manual"] }).notNull(),
  userId: uuid("user_id"),
  active: boolean("active").notNull().default(true),
  replacedAt: ts("replaced_at"),
  replacedBy: uuid("replaced_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const integrationSyncs = pgTable("integration_syncs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").notNull(),
  connectionId: uuid("connection_id"),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status", {
    enum: ["pending", "running", "succeeded", "failed", "needs_approval", "cancelled"],
  })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  requestSummary: jsonb("request_summary").$type<Record<string, unknown>>().notNull().default({}),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
  error: text("error"),
  requestedBy: uuid("requested_by"),
  approvedBy: uuid("approved_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const allTables = {
  tenants,
  users,
  sessions,
  roles,
  tenantMemberships,
  customers,
  contacts,
  auditLogs,
  csSkillVersions,
  tenantSkillSettings,
  playbooks,
  playbookVersions,
  playbookDocuments,
  playbookQuestions,
  playbookCriteria,
  meetings,
  meetingParticipants,
  meetingTranscriptSegments,
  meetingStreamTickets,
  intelligenceSuggestions,
  meetingLiveSignals,
  meetingNotes,
  tenantHealthSettings,
  meetingAnalyses,
  intelligenceIndicators,
  customerHealthSnapshots,
  churnSignals,
  expansionOpportunities,
  actionPlans,
  actionTasks,
  crmConnections,
  meetingCrmLinks,
  integrationSyncs,
};
