import {
  CreateCrmConnectionRequest,
  CrmConnection,
  CrmEntityType,
  CrmProviderInfo,
  CrmProviderKey,
  LinkCrmRecordRequest,
  MeetingCrmLink,
  ParsedCrmReference,
  type CrmRecordSnapshot,
} from "@sci/contracts";
import { crmClientFactory, listProviders, parseCrmReference, ReferenceError } from "@sci/crm-hub";
import { and, asc, crmConnections, eq, meetingCrmLinks, meetings, sql, users, type Tx } from "@sci/db";
import { decryptSecret, encryptSecret, keyringFromEnv, type Keyring } from "@sci/security";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, HttpError, notFound, pgCode } from "../lib/errors.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

const Id = z.object({ id: z.uuid() });
let keyring: Keyring | null | undefined;
function getKeyring(): Keyring {
  if (keyring === undefined) {
    try {
      keyring = keyringFromEnv();
    } catch {
      keyring = null;
    }
  }
  if (!keyring)
    throw new HttpError(
      503,
      "encryption_not_configured",
      "Cofre de credenciais não configurado no servidor (SCI_ENCRYPTION_KEYS)",
    );
  return keyring;
}

const toConnection = (c: typeof crmConnections.$inferSelect): CrmConnection => ({
  id: c.id,
  provider: c.provider,
  label: c.label,
  externalAccountId: c.externalAccountId,
  authType: c.authType,
  status: c.status,
  hasCredentials: !!c.encryptedCredentials,
  lastValidatedAt: c.lastValidatedAt,
  lastError: c.lastError,
  createdAt: c.createdAt,
});

async function listLinks(tx: Tx, meetingId: string): Promise<MeetingCrmLink[]> {
  const rows = await tx
    .select({ l: meetingCrmLinks, userName: users.name })
    .from(meetingCrmLinks)
    .leftJoin(users, eq(users.id, meetingCrmLinks.userId))
    .where(eq(meetingCrmLinks.meetingId, meetingId))
    .orderBy(asc(meetingCrmLinks.createdAt));
  return rows.map(({ l, userName }) => ({
    id: l.id,
    meetingId: l.meetingId,
    provider: l.provider,
    connectionId: l.connectionId,
    externalAccountId: l.externalAccountId,
    entityType: l.entityType,
    externalRecordId: l.externalRecordId,
    recordUrl: l.recordUrl,
    customerId: l.customerId,
    contactId: l.contactId,
    snapshot: (l.recordSnapshot as CrmRecordSnapshot | null) ?? null,
    validationStatus: l.validationStatus,
    validationError: l.validationError,
    origin: l.origin,
    userId: l.userId,
    userName,
    active: l.active,
    createdAt: l.createdAt,
    replacedAt: l.replacedAt,
  }));
}

/** Consulta o registro no CRM quando existe integração homologada e conexão ativa. */
async function tryValidate(
  req: FastifyRequest,
  tx: Tx,
  link: {
    id: string;
    provider: CrmProviderKey;
    entityType: CrmEntityType;
    externalRecordId: string;
    connectionId: string | null;
  },
) {
  const factory = crmClientFactory(link.provider);
  if (!factory || !link.connectionId) return;
  const [conn] = await tx.select().from(crmConnections).where(eq(crmConnections.id, link.connectionId));
  if (!conn?.encryptedCredentials || conn.status !== "active") return;
  try {
    const secret = decryptSecret(conn.encryptedCredentials, getKeyring(), req.tenant!.tenantId);
    const snap = await factory({
      externalAccountId: conn.externalAccountId,
      secret,
      authType: conn.authType,
    }).getRecord(link.entityType, link.externalRecordId);
    await tx
      .update(meetingCrmLinks)
      .set({
        recordSnapshot: snap,
        validationStatus: "validated",
        validatedAt: sql`now()`,
        validationError: null,
      })
      .where(eq(meetingCrmLinks.id, link.id));
  } catch (err) {
    await tx
      .update(meetingCrmLinks)
      .set({ validationStatus: "failed", validationError: (err as Error).message.slice(0, 500) })
      .where(eq(meetingCrmLinks.id, link.id));
  }
}

export async function crmRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/crm/providers",
    {
      schema: { tags: ["crm"], response: { 200: z.array(CrmProviderInfo) } },
      preHandler: requirePermission("integrations.read"),
    },
    async () => listProviders(),
  );

  app.get(
    "/crm/connections",
    {
      schema: { tags: ["crm"], response: { 200: z.array(CrmConnection) } },
      preHandler: requirePermission("integrations.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) =>
        (await tx.select().from(crmConnections).orderBy(asc(crmConnections.createdAt))).map(toConnection),
      ),
  );

  app.post(
    "/crm/connections",
    {
      schema: { tags: ["crm"], body: CreateCrmConnectionRequest, response: { 201: CrmConnection } },
      preHandler: requirePermission("integrations.manage"),
    },
    async (req, reply) => {
      const b = req.body;
      const encrypted = b.secret ? encryptSecret(b.secret, getKeyring(), req.tenant!.tenantId) : null;
      try {
        const c = await tenantTx(req, async (tx) => {
          const [row] = await tx
            .insert(crmConnections)
            .values({
              tenantId: req.tenant!.tenantId,
              provider: b.provider,
              label: b.label,
              externalAccountId: b.externalAccountId,
              authType: b.authType,
              encryptedCredentials: encrypted,
              createdBy: req.auth!.userId,
            })
            .returning();
          // a credencial nunca entra no log de auditoria
          await audit(tx, req, {
            action: "crm.connection.created",
            entityType: "crm_connection",
            entityId: row!.id,
            metadata: { provider: b.provider, account: b.externalAccountId, withSecret: !!encrypted },
          });
          return row!;
        });
        return reply.status(201).send(toConnection(c));
      } catch (err) {
        if (pgCode(err) === "23505") throw conflict("Esta conta do CRM já está conectada");
        throw err;
      }
    },
  );

  app.patch(
    "/crm/connections/:id",
    {
      schema: {
        tags: ["crm"],
        params: Id,
        body: z.object({
          status: z.enum(["pending", "disabled"]).optional(),
          label: z.string().trim().min(2).max(120).optional(),
          secret: z.string().min(8).max(4000).optional(),
        }),
        response: { 200: CrmConnection },
      },
      preHandler: requirePermission("integrations.manage"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const patch: Partial<typeof crmConnections.$inferInsert> = {};
        if (req.body.status) patch.status = req.body.status;
        if (req.body.label) patch.label = req.body.label;
        if (req.body.secret) {
          patch.encryptedCredentials = encryptSecret(req.body.secret, getKeyring(), req.tenant!.tenantId);
          patch.status = "pending";
        }
        const [c] = await tx
          .update(crmConnections)
          .set(patch)
          .where(eq(crmConnections.id, req.params.id))
          .returning();
        if (!c) throw notFound("Conexão");
        await audit(tx, req, {
          action: "crm.connection.updated",
          entityType: "crm_connection",
          entityId: c.id,
          metadata: { status: req.body.status, label: req.body.label, secretRotated: !!req.body.secret },
        });
        return toConnection(c);
      }),
  );

  app.post(
    "/crm/connections/:id/validate",
    {
      schema: { tags: ["crm"], params: Id, response: { 200: CrmConnection } },
      preHandler: requirePermission("integrations.manage"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const [c] = await tx.select().from(crmConnections).where(eq(crmConnections.id, req.params.id));
        if (!c) throw notFound("Conexão");
        const factory = crmClientFactory(c.provider);
        if (!factory)
          throw conflict(
            "A integração com este CRM ainda não foi homologada. A conexão fica registrada e será validada quando a integração for liberada.",
          );
        if (!c.encryptedCredentials) throw badRequest("Informe a credencial da conexão");
        try {
          await factory({
            externalAccountId: c.externalAccountId,
            secret: decryptSecret(c.encryptedCredentials, getKeyring(), req.tenant!.tenantId),
            authType: c.authType,
          }).validateConnection();
          await tx
            .update(crmConnections)
            .set({ status: "active", lastValidatedAt: sql`now()`, lastError: null })
            .where(eq(crmConnections.id, c.id));
        } catch (err) {
          await tx
            .update(crmConnections)
            .set({ status: "error", lastError: (err as Error).message.slice(0, 500) })
            .where(eq(crmConnections.id, c.id));
        }
        const [after] = await tx.select().from(crmConnections).where(eq(crmConnections.id, c.id));
        return toConnection(after!);
      }),
  );

  app.post(
    "/crm/parse-reference",
    {
      schema: {
        tags: ["crm"],
        body: LinkCrmRecordRequest.pick({ provider: true, reference: true, entityType: true }),
        response: { 200: ParsedCrmReference },
      },
      preHandler: requirePermission("meetings.read"),
    },
    async (req) => {
      try {
        return parseCrmReference(req.body.provider, req.body.reference, req.body.entityType);
      } catch (err) {
        if (err instanceof ReferenceError) throw badRequest(err.message);
        throw err;
      }
    },
  );

  // Vínculo manual da reunião ao registro do CRM ---------------------------------
  app.get(
    "/meetings/:id/crm-links",
    {
      schema: { tags: ["crm"], params: Id, response: { 200: z.array(MeetingCrmLink) } },
      preHandler: requirePermission("meetings.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const [m] = await tx.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, req.params.id));
        if (!m) throw notFound("Reunião");
        return listLinks(tx, m.id);
      }),
  );

  app.post(
    "/meetings/:id/crm-link",
    {
      schema: {
        tags: ["crm"],
        params: Id,
        body: LinkCrmRecordRequest,
        response: { 201: z.array(MeetingCrmLink) },
      },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req, reply) => {
      let parsed;
      try {
        parsed = parseCrmReference(req.body.provider, req.body.reference, req.body.entityType);
      } catch (err) {
        if (err instanceof ReferenceError) throw badRequest(err.message);
        throw err;
      }
      const links = await tenantTx(req, async (tx) => {
        const [m] = await tx.select().from(meetings).where(eq(meetings.id, req.params.id));
        if (!m) throw notFound("Reunião");
        if (m.ownerUserId !== req.auth!.userId && !req.tenant!.permissions.has("meetings.manage"))
          throw forbidden("Apenas o responsável pela reunião pode vinculá-la");
        const [current] = await tx
          .select()
          .from(meetingCrmLinks)
          .where(and(eq(meetingCrmLinks.meetingId, m.id), eq(meetingCrmLinks.active, true)));
        if (current) {
          if (!req.tenant!.permissions.has("crm.link.change"))
            throw forbidden("Alterar um vínculo existente exige a permissão crm.link.change");
          await tx
            .update(meetingCrmLinks)
            .set({ active: false, replacedAt: sql`now()`, replacedBy: req.auth!.userId })
            .where(eq(meetingCrmLinks.id, current.id));
        }
        let connectionId = req.body.connectionId ?? null;
        if (!connectionId) {
          const conns = await tx
            .select()
            .from(crmConnections)
            .where(
              and(eq(crmConnections.provider, parsed.provider), sql`${crmConnections.status} <> 'disabled'`),
            );
          const match =
            conns.find(
              (c) =>
                parsed.externalAccountId &&
                c.externalAccountId.toLowerCase().includes(parsed.externalAccountId.toLowerCase()),
            ) ?? (conns.length === 1 ? conns[0] : undefined);
          connectionId = match?.id ?? null;
        }
        const [link] = await tx
          .insert(meetingCrmLinks)
          .values({
            tenantId: req.tenant!.tenantId,
            meetingId: m.id,
            connectionId,
            provider: parsed.provider,
            externalAccountId: parsed.externalAccountId,
            entityType: parsed.entityType,
            externalRecordId: parsed.externalRecordId,
            recordUrl: parsed.recordUrl,
            customerId: m.customerId,
            origin: "manual",
            userId: req.auth!.userId,
          })
          .returning({ id: meetingCrmLinks.id });
        await tryValidate(req, tx, {
          id: link!.id,
          provider: parsed.provider,
          entityType: parsed.entityType,
          externalRecordId: parsed.externalRecordId,
          connectionId,
        });
        await audit(tx, req, {
          action: current ? "meeting.crm_link.changed" : "meeting.crm_link.created",
          entityType: "meeting",
          entityId: m.id,
          metadata: {
            provider: parsed.provider,
            entityType: parsed.entityType,
            externalRecordId: parsed.externalRecordId,
            previous: current
              ? { provider: current.provider, externalRecordId: current.externalRecordId }
              : null,
          },
        });
        return listLinks(tx, m.id);
      }).catch((err) => {
        if (pgCode(err) === "23503") throw badRequest("Conexão inválida para este tenant");
        throw err;
      });
      return reply.status(201).send(links);
    },
  );

  app.delete(
    "/meetings/:id/crm-link",
    { schema: { tags: ["crm"], params: Id }, preHandler: requirePermission("crm.link.change") },
    async (req, reply) => {
      await tenantTx(req, async (tx) => {
        const r = await tx
          .update(meetingCrmLinks)
          .set({ active: false, replacedAt: sql`now()`, replacedBy: req.auth!.userId })
          .where(and(eq(meetingCrmLinks.meetingId, req.params.id), eq(meetingCrmLinks.active, true)))
          .returning({ id: meetingCrmLinks.id });
        if (!r.length) throw notFound("Vínculo");
        await audit(tx, req, {
          action: "meeting.crm_link.removed",
          entityType: "meeting",
          entityId: req.params.id,
        });
      });
      return reply.status(204).send();
    },
  );
}
