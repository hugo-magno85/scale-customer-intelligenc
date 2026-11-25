import {
  AddMemberRequest,
  AuditLogEntry,
  PERMISSIONS,
  Role,
  TenantMember,
  UpdateMemberRequest,
  UpdateRolePermissionsRequest,
} from "@sci/contracts";
import { and, auditLogs, desc, eq, roles, tenantMemberships, users, type Tx } from "@sci/db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound, pgCode } from "../lib/errors.js";
import { findOrCreateUser } from "../lib/tenant-setup.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

const Id = z.object({ id: z.uuid() });

async function listMembers(tx: Tx) {
  const rows = await tx
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      roleId: roles.id,
      roleName: roles.name,
      status: tenantMemberships.status,
      createdAt: tenantMemberships.createdAt,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .orderBy(users.name);
  return rows;
}

async function activeAdminCount(tx: Tx) {
  const rows = await tx
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(and(eq(roles.systemKey, "tenant_admin"), eq(tenantMemberships.status, "active")));
  return rows.length;
}

export async function tenantAdminRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  // Papéis e permissões --------------------------------------------------
  app.get(
    "/roles",
    {
      schema: { tags: ["rbac"], response: { 200: z.array(Role) } },
      preHandler: requirePermission("users.read"),
    },
    async (req) => {
      const rows = await tenantTx(req, (tx) => tx.select().from(roles).orderBy(roles.name));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        systemKey: r.systemKey,
        permissions: r.permissions as Role["permissions"],
      }));
    },
  );

  app.get(
    "/permissions",
    { schema: { tags: ["rbac"], response: { 200: z.array(z.string()) } } },
    async () => [...PERMISSIONS],
  );

  app.put(
    "/roles/:id/permissions",
    {
      schema: { tags: ["rbac"], params: Id, body: UpdateRolePermissionsRequest, response: { 200: Role } },
      preHandler: requirePermission("roles.manage"),
    },
    async (req) => {
      return tenantTx(req, async (tx) => {
        const [current] = await tx.select().from(roles).where(eq(roles.id, req.params.id));
        if (!current) throw notFound("Papel");
        if (current.systemKey === "tenant_admin") {
          throw badRequest("As permissões do Administrador do tenant não podem ser reduzidas");
        }
        const permissions = [...new Set(req.body.permissions)];
        const [r] = await tx
          .update(roles)
          .set({ permissions })
          .where(eq(roles.id, req.params.id))
          .returning();
        await audit(tx, req, {
          action: "role.permissions.updated",
          entityType: "role",
          entityId: r!.id,
          metadata: { before: current.permissions, after: permissions },
        });
        return {
          id: r!.id,
          name: r!.name,
          systemKey: r!.systemKey,
          permissions: r!.permissions as Role["permissions"],
        };
      });
    },
  );

  // Membros ----------------------------------------------------------------
  app.get(
    "/members",
    {
      schema: { tags: ["users"], response: { 200: z.array(TenantMember) } },
      preHandler: requirePermission("users.read"),
    },
    async (req) => tenantTx(req, listMembers),
  );

  app.post(
    "/members",
    {
      schema: { tags: ["users"], body: AddMemberRequest, response: { 201: TenantMember } },
      preHandler: requirePermission("users.manage"),
    },
    async (req, reply) => {
      const tenantId = req.tenant!.tenantId;
      try {
        const member = await tenantTx(req, async (tx) => {
          const { userId, created } = await findOrCreateUser(tx, req.body);
          await tx.insert(tenantMemberships).values({ tenantId, userId, roleId: req.body.roleId });
          await audit(tx, req, {
            action: "member.added",
            entityType: "user",
            entityId: userId,
            metadata: { roleId: req.body.roleId, userCreated: created },
          });
          return (await listMembers(tx)).find((m) => m.userId === userId)!;
        });
        return reply.status(201).send(member);
      } catch (err) {
        if (pgCode(err) === "23505") throw conflict("Usuário já é membro deste tenant");
        if (pgCode(err) === "23503") throw badRequest("Papel inválido para este tenant");
        throw err;
      }
    },
  );

  app.patch(
    "/members/:id",
    {
      schema: { tags: ["users"], params: Id, body: UpdateMemberRequest, response: { 200: TenantMember } },
      preHandler: requirePermission("users.manage"),
    },
    async (req) => {
      if (req.params.id === req.auth!.userId && req.body.status === "disabled") {
        throw badRequest("Você não pode desativar o próprio acesso");
      }
      try {
        return await tenantTx(req, async (tx) => {
          const [before] = await tx
            .select()
            .from(tenantMemberships)
            .where(eq(tenantMemberships.userId, req.params.id));
          if (!before) throw notFound("Membro");
          const patch: Partial<typeof tenantMemberships.$inferInsert> = {};
          if (req.body.roleId) patch.roleId = req.body.roleId;
          if (req.body.status) patch.status = req.body.status;
          if (Object.keys(patch).length) {
            await tx.update(tenantMemberships).set(patch).where(eq(tenantMemberships.userId, req.params.id));
          }
          if ((await activeAdminCount(tx)) === 0)
            throw badRequest("O tenant precisa de ao menos um administrador ativo");
          await audit(tx, req, {
            action: "member.updated",
            entityType: "user",
            entityId: req.params.id,
            metadata: { before: { roleId: before.roleId, status: before.status }, after: patch },
          });
          return (await listMembers(tx)).find((m) => m.userId === req.params.id)!;
        });
      } catch (err) {
        if (pgCode(err) === "23503") throw badRequest("Papel inválido para este tenant");
        throw err;
      }
    },
  );

  // Auditoria --------------------------------------------------------------
  app.get(
    "/audit-logs",
    {
      schema: {
        tags: ["audit"],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
        response: { 200: z.array(AuditLogEntry) },
      },
      preHandler: requirePermission("audit.read"),
    },
    async (req) => {
      const rows = await tenantTx(req, (tx) =>
        tx.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(req.query.limit),
      );
      return rows.map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        ip: r.ip,
        createdAt: r.createdAt,
      }));
    },
  );
}
