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
};
