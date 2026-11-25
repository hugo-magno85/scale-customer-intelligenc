import {
  Contact,
  CreateContactRequest,
  CreateCustomerRequest,
  Customer,
  CustomerListQuery,
  DashboardSummary,
  UpdateCustomerRequest,
} from "@sci/contracts";
import { and, contacts, count, customers, eq, ilike, sql, users, type Tx } from "@sci/db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, notFound, pgCode } from "../lib/errors.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

const Id = z.object({ id: z.uuid() });

const customerSelect = {
  id: customers.id,
  name: customers.name,
  segment: customers.segment,
  ownerUserId: customers.ownerUserId,
  ownerName: users.name,
  relationshipStartedAt: customers.relationshipStartedAt,
  mrrCents: customers.mrrCents,
  mrrSource: customers.mrrSource,
  status: customers.status,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

async function getCustomer(tx: Tx, id: string) {
  const [c] = await tx
    .select(customerSelect)
    .from(customers)
    .leftJoin(users, eq(users.id, customers.ownerUserId))
    .where(eq(customers.id, id));
  if (!c) throw notFound("Cliente");
  return c;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function fkError(err: unknown): never {
  if (pgCode(err) === "23503") throw badRequest("Responsável precisa ser membro deste tenant");
  throw err;
}

export async function customerRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/customers",
    {
      schema: {
        tags: ["customers"],
        querystring: CustomerListQuery,
        response: { 200: z.object({ items: z.array(Customer), total: z.number().int() }) },
      },
      preHandler: requirePermission("customers.read"),
    },
    async (req) => {
      const { q, ownerUserId, segment, limit, offset } = req.query;
      const where = and(
        q ? ilike(customers.name, `%${escapeLike(q)}%`) : undefined,
        ownerUserId ? eq(customers.ownerUserId, ownerUserId) : undefined,
        segment ? eq(customers.segment, segment) : undefined,
      );
      return tenantTx(req, async (tx) => {
        const items = await tx
          .select(customerSelect)
          .from(customers)
          .leftJoin(users, eq(users.id, customers.ownerUserId))
          .where(where)
          .orderBy(sql`lower(${customers.name})`)
          .limit(limit)
          .offset(offset);
        const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(customers).where(where);
        return { items, total };
      });
    },
  );

  app.get(
    "/customers/:id",
    {
      schema: { tags: ["customers"], params: Id, response: { 200: Customer } },
      preHandler: requirePermission("customers.read"),
    },
    async (req) => tenantTx(req, (tx) => getCustomer(tx, req.params.id)),
  );

  app.post(
    "/customers",
    {
      schema: { tags: ["customers"], body: CreateCustomerRequest, response: { 201: Customer } },
      preHandler: requirePermission("customers.manage"),
    },
    async (req, reply) => {
      const b = req.body;
      const created = await tenantTx(req, async (tx) => {
        const [c] = await tx
          .insert(customers)
          .values({
            tenantId: req.tenant!.tenantId,
            name: b.name,
            segment: b.segment ?? null,
            ownerUserId: b.ownerUserId ?? null,
            relationshipStartedAt: b.relationshipStartedAt ?? null,
            mrrCents: b.mrrCents ?? null,
            mrrSource: b.mrrCents == null ? null : "manual",
          })
          .returning({ id: customers.id });
        await audit(tx, req, { action: "customer.created", entityType: "customer", entityId: c!.id });
        return getCustomer(tx, c!.id);
      }).catch(fkError);
      return reply.status(201).send(created);
    },
  );

  app.patch(
    "/customers/:id",
    {
      schema: { tags: ["customers"], params: Id, body: UpdateCustomerRequest, response: { 200: Customer } },
      preHandler: requirePermission("customers.manage"),
    },
    async (req) => {
      const b = req.body;
      const patch: Partial<typeof customers.$inferInsert> = {};
      if (b.name !== undefined) patch.name = b.name;
      if (b.segment !== undefined) patch.segment = b.segment ?? null;
      if (b.ownerUserId !== undefined) patch.ownerUserId = b.ownerUserId ?? null;
      if (b.relationshipStartedAt !== undefined)
        patch.relationshipStartedAt = b.relationshipStartedAt ?? null;
      if (b.status !== undefined) patch.status = b.status;
      if (b.mrrCents !== undefined) {
        patch.mrrCents = b.mrrCents ?? null;
        patch.mrrSource = b.mrrCents == null ? null : "manual";
      }
      return tenantTx(req, async (tx) => {
        const before = await getCustomer(tx, req.params.id);
        if (Object.keys(patch).length)
          await tx.update(customers).set(patch).where(eq(customers.id, req.params.id));
        await audit(tx, req, {
          action: "customer.updated",
          entityType: "customer",
          entityId: req.params.id,
          metadata: {
            changed: Object.keys(patch),
            before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof typeof before]])),
          },
        });
        return getCustomer(tx, req.params.id);
      }).catch(fkError);
    },
  );

  app.delete(
    "/customers/:id",
    { schema: { tags: ["customers"], params: Id }, preHandler: requirePermission("customers.manage") },
    async (req, reply) => {
      await tenantTx(req, async (tx) => {
        const del = await tx
          .delete(customers)
          .where(eq(customers.id, req.params.id))
          .returning({ id: customers.id, name: customers.name });
        if (!del.length) throw notFound("Cliente");
        await audit(tx, req, {
          action: "customer.deleted",
          entityType: "customer",
          entityId: req.params.id,
          metadata: { name: del[0]!.name },
        });
      });
      return reply.status(204).send();
    },
  );

  // Contatos ---------------------------------------------------------------
  app.get(
    "/customers/:id/contacts",
    {
      schema: { tags: ["customers"], params: Id, response: { 200: z.array(Contact) } },
      preHandler: requirePermission("customers.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        await getCustomer(tx, req.params.id);
        return tx
          .select({
            id: contacts.id,
            customerId: contacts.customerId,
            name: contacts.name,
            email: contacts.email,
            phone: contacts.phone,
            jobTitle: contacts.jobTitle,
            createdAt: contacts.createdAt,
          })
          .from(contacts)
          .where(eq(contacts.customerId, req.params.id))
          .orderBy(contacts.name);
      }),
  );

  app.post(
    "/customers/:id/contacts",
    {
      schema: { tags: ["customers"], params: Id, body: CreateContactRequest, response: { 201: Contact } },
      preHandler: requirePermission("customers.manage"),
    },
    async (req, reply) => {
      const c = await tenantTx(req, async (tx) => {
        await getCustomer(tx, req.params.id);
        const [row] = await tx
          .insert(contacts)
          .values({
            tenantId: req.tenant!.tenantId,
            customerId: req.params.id,
            name: req.body.name,
            email: req.body.email ?? null,
            phone: req.body.phone ?? null,
            jobTitle: req.body.jobTitle ?? null,
          })
          .returning();
        await audit(tx, req, {
          action: "contact.created",
          entityType: "contact",
          entityId: row!.id,
          metadata: { customerId: req.params.id },
        });
        return row!;
      });
      const { tenantId: _t, updatedAt: _u, ...out } = c;
      return reply.status(201).send(out);
    },
  );

  // Dashboard -------------------------------------------------------------
  // Só retorna o que existe de fato. Indicadores que dependem de análises
  // de reuniões (Etapas 4–5) voltam como null até haver dados reais.
  app.get(
    "/dashboard/summary",
    {
      schema: { tags: ["dashboard"], response: { 200: DashboardSummary } },
      preHandler: requirePermission("reports.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const [{ n } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(customers)
          .where(eq(customers.status, "active"));
        return {
          activeCustomers: n,
          healthy: null,
          attention: null,
          highRisk: null,
          averageHealth: null,
          revenueAtRiskCents: null,
          openExpansionOpportunities: null,
          analyzedMeetings: 0,
          pendingActionTasks: null,
          overdueActionTasks: null,
        };
      }),
  );
}
