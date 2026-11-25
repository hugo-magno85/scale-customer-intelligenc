import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  inet,
  jsonb,
  pgTable,
  primaryKey,
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

export const allTables = {
  tenants,
  users,
  sessions,
  roles,
  tenantMemberships,
  customers,
  contacts,
  auditLogs,
};
