import { CreateTenantRequest, Tenant } from "@sci/contracts";
import { desc, tenantMemberships, tenants } from "@sci/db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { conflict, pgCode } from "../lib/errors.js";
import { createDefaultRoles, findOrCreateUser, switchTenant } from "../lib/tenant-setup.js";
import { requirePlatformAdmin } from "../plugins/context.js";

const toTenant = (t: typeof tenants.$inferSelect) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  status: t.status,
  createdAt: t.createdAt,
});

/** Rotas exclusivas do superadmin (Academia Scale). */
export async function platformRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();
  const adminCtx = (userId: string) => ({ tenantId: null, userId, isPlatformAdmin: true });

  app.get(
    "/platform/tenants",
    { schema: { tags: ["platform"], response: { 200: z.array(Tenant) } }, preHandler: requirePlatformAdmin },
    async (req) => {
      const rows = await app.database.withContext(adminCtx(req.auth!.userId), (tx) =>
        tx.select().from(tenants).orderBy(desc(tenants.createdAt)),
      );
      return rows.map(toTenant);
    },
  );

  app.post(
    "/platform/tenants",
    {
      schema: { tags: ["platform"], body: CreateTenantRequest, response: { 201: Tenant } },
      preHandler: requirePlatformAdmin,
    },
    async (req, reply) => {
      const body = req.body;
      try {
        const tenant = await app.database.withContext(adminCtx(req.auth!.userId), async (tx) => {
          const [t] = await tx.insert(tenants).values({ name: body.name, slug: body.slug }).returning();
          await switchTenant(tx, t!.id);
          const roleIds = await createDefaultRoles(tx, t!.id);
          const { userId, created } = await findOrCreateUser(tx, body.admin);
          await tx
            .insert(tenantMemberships)
            .values({ tenantId: t!.id, userId, roleId: roleIds.tenant_admin });
          await audit(tx, req, {
            tenantId: t!.id,
            action: "tenant.created",
            entityType: "tenant",
            entityId: t!.id,
            metadata: { slug: body.slug, adminUserId: userId, adminCreated: created },
          });
          return t!;
        });
        return reply.status(201).send(toTenant(tenant));
      } catch (err) {
        if (pgCode(err) === "23505") throw conflict("Já existe um tenant com este slug");
        throw err;
      }
    },
  );
}
