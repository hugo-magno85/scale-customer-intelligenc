import { MeetingIntelligence, MeetingNoteRequest } from "@sci/contracts";
import { asc, eq, meetingNotes, meetings } from "@sci/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { forbidden, notFound } from "../lib/errors.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

const Id = z.object({ id: z.uuid() });
const IdSid = z.object({ id: z.uuid(), sid: z.uuid() });

/** Garante que a reunião existe no tenant (RLS) e que o usuário pode conduzi-la. */
async function guard(req: FastifyRequest, meetingId: string, write: boolean) {
  const [m] = await tenantTx(req, (tx) =>
    tx.select({ owner: meetings.ownerUserId }).from(meetings).where(eq(meetings.id, meetingId)),
  );
  if (!m) throw notFound("Reunião");
  if (write && m.owner !== req.auth!.userId && !req.tenant!.permissions.has("meetings.manage")) {
    throw forbidden("Apenas o responsável pela reunião pode interagir com as sugestões");
  }
  return req.server.brains.get(meetingId, { tenantId: req.tenant!.tenantId, userId: req.auth!.userId });
}

export async function intelligenceRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  // Modo Preparação / estado atual da inteligência
  app.get(
    "/meetings/:id/intelligence",
    {
      schema: { tags: ["intelligence"], params: Id, response: { 200: MeetingIntelligence } },
      preHandler: requirePermission("meetings.read"),
    },
    async (req) => {
      const brain = await guard(req, req.params.id, false);
      const s = brain.state();
      return s.current || s.mode === "ended" ? s : brain.prepare();
    },
  );

  const action = (
    path: string,
    run: (b: Awaited<ReturnType<typeof guard>>, sid: string) => Promise<unknown>,
    name: string,
  ) =>
    app.post(
      `/meetings/:id/suggestions/:sid/${path}`,
      {
        schema: { tags: ["intelligence"], params: IdSid, response: { 200: MeetingIntelligence } },
        preHandler: requirePermission("meetings.capture"),
      },
      async (req) => {
        const brain = await guard(req, req.params.id, true);
        await run(brain, req.params.sid);
        await tenantTx(req, (tx) =>
          audit(tx, req, {
            action: name,
            entityType: "suggestion",
            entityId: req.params.sid,
            metadata: { meetingId: req.params.id },
          }),
        );
        return brain.state();
      },
    );
  action("done", (b, sid) => b.markDone(sid), "suggestion.done");
  action("ignore", (b, sid) => b.ignore(sid), "suggestion.ignored");

  app.post(
    "/meetings/:id/suggestions/next",
    {
      schema: { tags: ["intelligence"], params: Id, response: { 200: MeetingIntelligence } },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req) => {
      const brain = await guard(req, req.params.id, true);
      return brain.requestAnother();
    },
  );

  app.post(
    "/meetings/:id/notes",
    {
      schema: {
        tags: ["intelligence"],
        params: Id,
        body: MeetingNoteRequest,
        response: { 201: z.object({ id: z.uuid(), text: z.string(), createdAt: z.string() }) },
      },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req, reply) => {
      await guard(req, req.params.id, true);
      const [n] = await tenantTx(req, (tx) =>
        tx
          .insert(meetingNotes)
          .values({
            tenantId: req.tenant!.tenantId,
            meetingId: req.params.id,
            authorId: req.auth!.userId,
            suggestionId: req.body.suggestionId ?? null,
            text: req.body.text,
          })
          .returning({ id: meetingNotes.id, text: meetingNotes.text, createdAt: meetingNotes.createdAt }),
      );
      return reply.status(201).send(n!);
    },
  );

  app.get(
    "/meetings/:id/notes",
    {
      schema: {
        tags: ["intelligence"],
        params: Id,
        response: { 200: z.array(z.object({ id: z.uuid(), text: z.string(), createdAt: z.string() })) },
      },
      preHandler: requirePermission("meetings.read"),
    },
    async (req) =>
      tenantTx(req, (tx) =>
        tx
          .select({ id: meetingNotes.id, text: meetingNotes.text, createdAt: meetingNotes.createdAt })
          .from(meetingNotes)
          .where(eq(meetingNotes.meetingId, req.params.id))
          .orderBy(asc(meetingNotes.createdAt)),
      ),
  );
}
