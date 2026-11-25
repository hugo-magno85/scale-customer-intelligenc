import { and, eq, roles, sql, tenantMemberships, tenants, type Database, type Tx } from "@sci/db";
import { isPermission, type Permission } from "@sci/contracts";
import { hashToken } from "@sci/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export const SESSION_COOKIE = "sci_session";

export interface AuthContext {
  userId: string;
  sessionId: string;
  sessionKind: "web" | "extension";
  isPlatformAdmin: boolean;
  viaCookie: boolean;
}

export interface TenantContext {
  tenantId: string;
  roleId: string;
  permissions: Set<Permission>;
}

declare module "fastify" {
  interface FastifyInstance {
    database: Database;
    config: Config;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    tenant: TenantContext | null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readToken(req: FastifyRequest): { token: string; viaCookie: boolean } | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return { token: header.slice(7).trim(), viaCookie: false };
  const cookie = req.cookies?.[SESSION_COOKIE];
  return cookie ? { token: cookie, viaCookie: true } : null;
}

/**
 * Resolve sessão (cookie httpOnly no web, Bearer na extensão) e, quando o
 * header `x-tenant-id` está presente, o vínculo ativo do usuário com o tenant.
 */
export const contextPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("auth", null);
  app.decorateRequest("tenant", null);

  app.addHook("onRequest", async (req) => {
    const t = readToken(req);
    if (!t || t.token.length > 200) return;
    const rows = await app.database.withContext({ tenantId: null, userId: null }, (tx) =>
      tx.execute<{
        session_id: string;
        user_id: string;
        kind: "web" | "extension";
        is_platform_admin: boolean;
      }>(sql`SELECT * FROM app.auth_session_user(${hashToken(t.token)})`),
    );
    const s = rows.rows[0];
    if (!s) return;
    req.auth = {
      userId: s.user_id,
      sessionId: s.session_id,
      sessionKind: s.kind,
      isPlatformAdmin: s.is_platform_admin,
      viaCookie: t.viaCookie,
    };
  });

  // Proteção CSRF: requisições que alteram estado autenticadas por cookie
  // precisam vir de uma origem permitida.
  app.addHook("onRequest", async (req) => {
    if (!req.auth?.viaCookie || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || !app.config.corsOrigins.includes(origin)) throw forbidden("Origem não permitida");
  });

  app.addHook("preHandler", async (req) => {
    const raw = req.headers["x-tenant-id"];
    if (!raw || !req.auth) return;
    const tenantId = Array.isArray(raw) ? raw[0] : raw;
    if (!tenantId || !UUID_RE.test(tenantId)) throw forbidden("Tenant inválido");
    const userId = req.auth.userId;
    const rows = await app.database.withContext({ tenantId, userId }, (tx) =>
      tx
        .select({ roleId: tenantMemberships.roleId, permissions: roles.permissions })
        .from(tenantMemberships)
        .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.status, "active"),
            eq(tenants.status, "active"),
          ),
        ),
    );
    const m = rows[0];
    if (!m) throw forbidden("Sem acesso a este tenant");
    req.tenant = { tenantId, roleId: m.roleId, permissions: new Set(m.permissions.filter(isPermission)) };
  });
});

export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.auth) throw unauthorized();
}

export async function requirePlatformAdmin(req: FastifyRequest): Promise<void> {
  if (!req.auth) throw unauthorized();
  if (!req.auth.isPlatformAdmin) throw forbidden("Apenas superadmin");
}

/** preHandler: exige tenant selecionado e todas as permissões informadas. */
export function requirePermission(...perms: Permission[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.auth) throw unauthorized();
    if (!req.tenant) throw forbidden("Selecione um tenant (header x-tenant-id)");
    for (const p of perms) if (!req.tenant.permissions.has(p)) throw forbidden(`Permissão necessária: ${p}`);
  };
}

/** Transação com o contexto de segurança do request (tenant + usuário). */
export function tenantTx<T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!req.tenant || !req.auth) throw forbidden();
  return req.server.database.withContext({ tenantId: req.tenant.tenantId, userId: req.auth.userId }, fn);
}
