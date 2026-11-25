import { SkillInfo, TenantSkillSettings } from "@sci/contracts";
import { skillManifest } from "@sci/cs-skill";
import { tenantSkillSettings, type Tx } from "@sci/db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../lib/audit.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

export async function loadSkillSettings(tx: Tx): Promise<TenantSkillSettings> {
  const [row] = await tx.select().from(tenantSkillSettings);
  // valores salvos inválidos (ex.: após mudança de contrato) voltam ao padrão
  const parsed = TenantSkillSettings.safeParse(row?.settings ?? {});
  return parsed.success ? parsed.data : TenantSkillSettings.parse({});
}

export async function skillRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/skill",
    {
      schema: { tags: ["skill"], response: { 200: SkillInfo } },
      preHandler: requirePermission("playbooks.read"),
    },
    async (req) => {
      const settings = await tenantTx(req, loadSkillSettings);
      return { ...skillManifest(), settings };
    },
  );

  app.put(
    "/skill/settings",
    {
      schema: { tags: ["skill"], body: TenantSkillSettings, response: { 200: TenantSkillSettings } },
      preHandler: requirePermission("skill.configure"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const before = await loadSkillSettings(tx);
        await tx
          .insert(tenantSkillSettings)
          .values({ tenantId: req.tenant!.tenantId, settings: req.body, updatedBy: req.auth!.userId })
          .onConflictDoUpdate({
            target: tenantSkillSettings.tenantId,
            set: { settings: req.body, updatedBy: req.auth!.userId, updatedAt: new Date().toISOString() },
          });
        await audit(tx, req, {
          action: "skill.settings.updated",
          entityType: "tenant",
          entityId: req.tenant!.tenantId,
          metadata: { before, after: req.body },
        });
        return req.body;
      }),
  );
}
