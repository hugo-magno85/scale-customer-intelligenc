import {
  ConsentRequest,
  CreateMeetingRequest,
  Meeting,
  ParticipantInput,
  STREAM_AUDIO,
  StreamTicket,
  TranscriptSegment,
  UpdateMeetingRequest,
  type StreamServerMessage,
} from "@sci/contracts";
import {
  and,
  asc,
  auditLogs as auditLogsTable,
  customers,
  desc,
  eq,
  meetingParticipants,
  meetings,
  meetingStreamTickets,
  meetingTranscriptSegments,
  playbooks,
  playbookVersions,
  sql,
  users,
  type Tx,
} from "@sci/db";
import { ensureSkillVersion } from "@sci/jobs";
import { generateToken, hashToken } from "@sci/security";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { WebSocket } from "ws";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound, pgCode } from "../lib/errors.js";
import { requirePermission, tenantTx } from "../plugins/context.js";
import { requestAnalysis } from "./customer-intelligence.js";

const Id = z.object({ id: z.uuid() });
const TICKET_TTL_MS = 60_000;
/** 16 kHz × 2 canais × 2 bytes = 64 KB/s; tolera rajadas de 3x. */
const MAX_BYTES_PER_SECOND = STREAM_AUDIO.sampleRate * STREAM_AUDIO.channels * 2 * 3;
const MAX_FRAME_BYTES = 64 * 1024;

async function getMeeting(tx: Tx, id: string): Promise<Meeting> {
  const [m] = await tx
    .select({
      m: meetings,
      ownerName: users.name,
      customerName: customers.name,
      playbookName: playbooks.name,
      playbookVersionNumber: playbookVersions.number,
    })
    .from(meetings)
    .leftJoin(users, eq(users.id, meetings.ownerUserId))
    .leftJoin(customers, eq(customers.id, meetings.customerId))
    .leftJoin(playbookVersions, eq(playbookVersions.id, meetings.playbookVersionId))
    .leftJoin(playbooks, eq(playbooks.id, playbookVersions.playbookId))
    .where(eq(meetings.id, id));
  if (!m) throw notFound("Reunião");
  const parts = await tx
    .select()
    .from(meetingParticipants)
    .where(eq(meetingParticipants.meetingId, id))
    .orderBy(asc(meetingParticipants.createdAt));
  return {
    id: m.m.id,
    ownerUserId: m.m.ownerUserId,
    ownerName: m.ownerName,
    customerId: m.m.customerId,
    customerName: m.customerName,
    playbookVersionId: m.m.playbookVersionId,
    playbookName: m.playbookName,
    playbookVersionNumber: m.playbookVersionNumber,
    skillVersion: m.m.skillVersion,
    platform: m.m.platform,
    externalRef: m.m.externalRef,
    title: m.m.title,
    meetingType: m.m.meetingType as Meeting["meetingType"],
    objective: m.m.objective,
    status: m.m.status,
    consentMethod: m.m.consentMethod,
    consentConfirmedAt: m.m.consentConfirmedAt,
    startedAt: m.m.startedAt,
    endedAt: m.m.endedAt,
    createdAt: m.m.createdAt,
    participants: parts.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      email: p.email,
      role: p.role,
      contactId: p.contactId,
      source: p.source,
    })),
  };
}

/** Resolve a versão publicada atual de um playbook ativo. */
async function publishedVersionOf(tx: Tx, playbookId: string): Promise<string> {
  const [v] = await tx
    .select({ id: playbookVersions.id, active: playbooks.active })
    .from(playbookVersions)
    .innerJoin(playbooks, eq(playbooks.id, playbookVersions.playbookId))
    .where(and(eq(playbookVersions.playbookId, playbookId), eq(playbookVersions.status, "published")));
  if (!v) throw badRequest("Este playbook não tem versão publicada");
  if (!v.active) throw badRequest("Este playbook está desativado");
  return v.id;
}

/** Só o responsável pela reunião (ou quem gerencia reuniões) pode alterá-la. */
function assertCanEdit(req: FastifyRequest, m: Meeting) {
  if (m.ownerUserId !== req.auth!.userId && !req.tenant!.permissions.has("meetings.manage")) {
    throw forbidden("Apenas o responsável pela reunião pode alterá-la");
  }
}

function mapFk(err: unknown): never {
  if (pgCode(err) === "23503") throw badRequest("Cliente, contato ou playbook inválido para este tenant");
  if (pgCode(err) === "23514")
    throw badRequest((err as { cause?: Error }).cause?.message ?? "Dados inconsistentes");
  throw err;
}

async function replaceParticipants(tx: Tx, tenantId: string, meetingId: string, list: ParticipantInput[]) {
  await tx.delete(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
  if (list.length) {
    await tx.insert(meetingParticipants).values(
      list.map((p) => ({
        tenantId,
        meetingId,
        displayName: p.displayName,
        email: p.email ?? null,
        role: p.role,
        contactId: p.contactId ?? null,
        source: p.source,
      })),
    );
  }
}

// Uma captura ativa por reunião neste processo.
const activeStreams = new Map<string, WebSocket>();

export async function meetingRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/meetings",
    {
      schema: { tags: ["meetings"], body: CreateMeetingRequest, response: { 201: Meeting } },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req, reply) => {
      const b = req.body;
      const m = await tenantTx(req, async (tx) => {
        const playbookVersionId = b.playbookId ? await publishedVersionOf(tx, b.playbookId) : null;
        const [row] = await tx
          .insert(meetings)
          .values({
            tenantId: req.tenant!.tenantId,
            ownerUserId: req.auth!.userId,
            customerId: b.customerId ?? null,
            playbookVersionId,
            skillVersion: await ensureSkillVersion(tx),
            platform: b.platform,
            externalRef: b.externalRef ?? null,
            title: b.title ?? null,
            meetingType: b.meetingType,
            objective: b.objective ?? null,
          })
          .returning({ id: meetings.id });
        await replaceParticipants(tx, req.tenant!.tenantId, row!.id, b.participants);
        await audit(tx, req, {
          action: "meeting.created",
          entityType: "meeting",
          entityId: row!.id,
          metadata: { platform: b.platform, playbookVersionId },
        });
        return getMeeting(tx, row!.id);
      }).catch(mapFk);
      return reply.status(201).send(m);
    },
  );

  app.get(
    "/meetings",
    {
      schema: {
        tags: ["meetings"],
        querystring: z.object({
          customerId: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
        response: { 200: z.array(Meeting) },
      },
      preHandler: requirePermission("meetings.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const rows = await tx
          .select({ id: meetings.id })
          .from(meetings)
          .where(req.query.customerId ? eq(meetings.customerId, req.query.customerId) : undefined)
          .orderBy(desc(meetings.createdAt))
          .limit(req.query.limit);
        return Promise.all(rows.map((r) => getMeeting(tx, r.id)));
      }),
  );

  app.get(
    "/meetings/:id",
    {
      schema: { tags: ["meetings"], params: Id, response: { 200: Meeting } },
      preHandler: requirePermission("meetings.read"),
    },
    async (req) => tenantTx(req, (tx) => getMeeting(tx, req.params.id)),
  );

  app.patch(
    "/meetings/:id",
    {
      schema: { tags: ["meetings"], params: Id, body: UpdateMeetingRequest, response: { 200: Meeting } },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const m = await getMeeting(tx, req.params.id);
        assertCanEdit(req, m);
        const b = req.body;
        const patch: Partial<typeof meetings.$inferInsert> = {};
        if (b.title !== undefined) patch.title = b.title ?? null;
        if (b.objective !== undefined) patch.objective = b.objective ?? null;
        if (b.meetingType !== undefined) patch.meetingType = b.meetingType;
        if (b.customerId !== undefined) patch.customerId = b.customerId ?? null;
        if (b.playbookId !== undefined) {
          if (m.status !== "preparing")
            throw conflict("O playbook só pode ser trocado antes de iniciar a captura");
          patch.playbookVersionId = b.playbookId ? await publishedVersionOf(tx, b.playbookId) : null;
        }
        if (Object.keys(patch).length) await tx.update(meetings).set(patch).where(eq(meetings.id, m.id));
        await audit(tx, req, {
          action: "meeting.updated",
          entityType: "meeting",
          entityId: m.id,
          metadata: { changed: Object.keys(patch) },
        });
        return getMeeting(tx, m.id);
      }).catch(mapFk),
  );

  app.put(
    "/meetings/:id/participants",
    {
      schema: {
        tags: ["meetings"],
        params: Id,
        body: z.object({ participants: z.array(ParticipantInput).max(100) }),
        response: { 200: Meeting },
      },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const m = await getMeeting(tx, req.params.id);
        assertCanEdit(req, m);
        await replaceParticipants(tx, req.tenant!.tenantId, m.id, req.body.participants);
        return getMeeting(tx, m.id);
      }).catch(mapFk),
  );

  // LGPD: confirmação explícita de que os participantes foram informados.
  app.post(
    "/meetings/:id/consent",
    {
      schema: { tags: ["meetings"], params: Id, body: ConsentRequest, response: { 200: Meeting } },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const m = await getMeeting(tx, req.params.id);
        assertCanEdit(req, m);
        if (m.status === "ended" || m.status === "analyzed") throw conflict("Reunião já encerrada");
        await tx
          .update(meetings)
          .set({
            consentMethod: req.body.method,
            consentConfirmedAt: sql`now()`,
            consentConfirmedBy: req.auth!.userId,
          })
          .where(eq(meetings.id, m.id));
        await audit(tx, req, {
          action: "meeting.consent.confirmed",
          entityType: "meeting",
          entityId: m.id,
          metadata: { method: req.body.method },
        });
        return getMeeting(tx, m.id);
      }),
  );

  app.post(
    "/meetings/:id/stream-ticket",
    {
      schema: { tags: ["meetings"], params: Id, response: { 201: StreamTicket } },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req, reply) => {
      const ticket = generateToken();
      const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
      await tenantTx(req, async (tx) => {
        const m = await getMeeting(tx, req.params.id);
        if (m.ownerUserId !== req.auth!.userId)
          throw forbidden("Apenas o responsável pela reunião pode capturá-la");
        if (!m.consentConfirmedAt)
          throw conflict("Confirme que os participantes foram informados antes de iniciar a captura");
        if (m.status !== "preparing" && m.status !== "live") throw conflict("Reunião já encerrada");
        await tx.insert(meetingStreamTickets).values({
          tokenHash: hashToken(ticket),
          tenantId: req.tenant!.tenantId,
          meetingId: m.id,
          userId: req.auth!.userId,
          expiresAt,
        });
      });
      return reply.status(201).send({ ticket, expiresAt, wsPath: "/v1/meetings/stream" });
    },
  );

  app.post(
    "/meetings/:id/end",
    {
      schema: { tags: ["meetings"], params: Id, response: { 200: Meeting } },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req) => {
      activeStreams.get(req.params.id)?.close(1000, "reunião encerrada");
      app.brains.drop(req.params.id);
      const ended = await tenantTx(req, async (tx) => {
        const m = await getMeeting(tx, req.params.id);
        assertCanEdit(req, m);
        if (m.status === "ended" || m.status === "analyzed") return { m, fresh: false };
        await tx
          .update(meetings)
          .set({ status: m.consentConfirmedAt ? "ended" : m.status, endedAt: sql`now()` })
          .where(eq(meetings.id, m.id));
        await audit(tx, req, { action: "meeting.ended", entityType: "meeting", entityId: m.id });
        return { m: await getMeeting(tx, m.id), fresh: true };
      });
      // Modo Análise: dispara automaticamente quando há transcrição
      if (ended.fresh && ended.m.status === "ended") {
        await requestAnalysis(req, ended.m.id, { onlyIfTranscript: true }).catch((err: Error) =>
          req.log.warn({ err: err.message }, "análise automática não iniciada"),
        );
        return tenantTx(req, (tx) => getMeeting(tx, ended.m.id));
      }
      return ended.m;
    },
  );

  app.get(
    "/meetings/:id/transcript",
    {
      schema: { tags: ["meetings"], params: Id, response: { 200: z.array(TranscriptSegment) } },
      preHandler: requirePermission("meetings.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        await getMeeting(tx, req.params.id);
        const rows = await tx
          .select()
          .from(meetingTranscriptSegments)
          .where(eq(meetingTranscriptSegments.meetingId, req.params.id))
          .orderBy(asc(meetingTranscriptSegments.startMs), asc(meetingTranscriptSegments.id));
        return rows.map((r) => ({
          id: r.id,
          channel: r.channel as 0 | 1,
          speaker: r.speaker,
          startMs: r.startMs,
          endMs: r.endMs,
          text: r.text,
          confidence: r.confidence,
        }));
      }),
  );

  // WebSocket de áudio ---------------------------------------------------------
  app.get("/meetings/stream", { websocket: true, schema: { hide: true } }, async (socket, req) => {
    const send = (m: StreamServerMessage) =>
      socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
    const fail = (code: number, errCode: string, message: string) => {
      send({ type: "error", code: errCode, message });
      socket.close(code, errCode);
    };
    const ticket = (req.query as { ticket?: string }).ticket;
    if (!ticket || ticket.length > 200) return fail(4401, "invalid_ticket", "Ticket ausente");
    const found = await app.database.withContext({ tenantId: null, userId: null }, (tx) =>
      tx.execute<{ tenant_id: string; meeting_id: string; user_id: string }>(
        sql`SELECT * FROM app.consume_stream_ticket(${hashToken(ticket)})`,
      ),
    );
    const t = found.rows[0];
    if (!t) return fail(4401, "invalid_ticket", "Ticket inválido, expirado ou já utilizado");
    const ctx = { tenantId: t.tenant_id, userId: t.user_id };
    const meetingId = t.meeting_id;
    const m = await app.database.withContext(ctx, (tx) => getMeeting(tx, meetingId));
    if (!m.consentConfirmedAt || (m.status !== "preparing" && m.status !== "live")) {
      return fail(4409, "not_capturable", "Reunião sem consentimento registrado ou já encerrada");
    }
    if (!app.transcription)
      return fail(
        4503,
        "transcription_unavailable",
        "Transcrição não configurada neste ambiente (DEEPGRAM_API_KEY)",
      );
    if (activeStreams.has(meetingId))
      return fail(4409, "already_streaming", "Esta reunião já está sendo capturada em outra conexão");
    activeStreams.set(meetingId, socket);

    const log = req.log.child({ meetingId });
    const brain = await app.brains.get(meetingId, ctx);
    const unsubscribe = brain.onChange((state) => send({ type: "intelligence", state }));
    let session: Awaited<ReturnType<NonNullable<typeof app.transcription>["open"]>> | null = null;
    const pending: Promise<unknown>[] = [];
    try {
      session = await app.transcription.open(
        { sampleRate: STREAM_AUDIO.sampleRate, channels: STREAM_AUDIO.channels },
        {
          onResult: (r) => {
            const speaker = r.channel === 0 ? "internal" : "customer";
            if (!r.isFinal) return void send({ type: "interim", channel: r.channel, speaker, text: r.text });
            const p = app.database
              .withContext(ctx, (tx) =>
                tx
                  .insert(meetingTranscriptSegments)
                  .values({
                    tenantId: ctx.tenantId,
                    meetingId,
                    channel: r.channel === 0 ? 0 : 1,
                    speaker,
                    startMs: r.startMs,
                    endMs: r.endMs,
                    text: r.text.slice(0, 5000),
                    confidence: r.confidence,
                  })
                  .returning({ id: meetingTranscriptSegments.id }),
              )
              .then(([row]) => {
                send({
                  type: "segment",
                  segment: {
                    id: row!.id,
                    channel: r.channel === 0 ? 0 : 1,
                    speaker,
                    startMs: r.startMs,
                    endMs: r.endMs,
                    text: r.text,
                    confidence: r.confidence,
                  },
                });
                // Camada 4 (contexto da reunião) → motor de decisão
                brain.onSegment({ id: row!.id, speaker, text: r.text, startMs: r.startMs });
              })
              .catch((err: Error) => log.error({ err: err.message }, "falha ao gravar segmento"));
            pending.push(p);
          },
          onError: (err) => log.warn({ err: err.message }, "erro do provedor de transcrição"),
          onClose: (reason) => {
            send({ type: "closed", reason });
            socket.close(1011, "transcription_closed");
          },
        },
      );
    } catch (err) {
      activeStreams.delete(meetingId);
      log.error({ err: (err as Error).message }, "não foi possível abrir a transcrição");
      unsubscribe();
      return fail(4502, "transcription_failed", "Não foi possível conectar ao serviço de transcrição");
    }

    await app.database.withContext(ctx, async (tx) => {
      await tx
        .update(meetings)
        .set({ status: "live", startedAt: sql`coalesce(${meetings.startedAt}, now())` })
        .where(eq(meetings.id, meetingId));
      await tx.insert(auditLogsTable).values({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "meeting.capture.started",
        entityType: "meeting",
        entityId: meetingId,
        metadata: {},
      });
    });

    let windowStart = Date.now();
    let windowBytes = 0;
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (data.length > MAX_FRAME_BYTES || data.length % (2 * STREAM_AUDIO.channels) !== 0) {
          return fail(4400, "invalid_audio", "Quadro de áudio inválido");
        }
        const now = Date.now();
        if (now - windowStart >= 1000) {
          windowStart = now;
          windowBytes = 0;
        }
        windowBytes += data.length;
        if (windowBytes > MAX_BYTES_PER_SECOND)
          return fail(4429, "rate_limited", "Taxa de áudio acima do permitido");
        session?.sendAudio(data);
        return;
      }
      try {
        const msg = JSON.parse(data.toString()) as { type?: string };
        if (msg.type === "finalize") session?.finalize();
      } catch {
        /* mensagens de controle inválidas são ignoradas */
      }
    });
    socket.on("close", () => {
      activeStreams.delete(meetingId);
      unsubscribe();
      void (async () => {
        await session?.close();
        await Promise.allSettled(pending);
        await app.database
          .withContext(ctx, (tx) =>
            tx.insert(auditLogsTable).values({
              tenantId: ctx.tenantId,
              actorUserId: ctx.userId,
              action: "meeting.capture.stopped",
              entityType: "meeting",
              entityId: meetingId,
              metadata: {},
            }),
          )
          .catch(() => undefined);
      })();
    });

    // Só avisa "pronto" depois de registrar os handlers: áudio enviado logo após o aviso não se perde
    send({ type: "ready", meetingId, sampleRate: STREAM_AUDIO.sampleRate, channels: STREAM_AUDIO.channels });
    const initial = brain.state();
    send({ type: "intelligence", state: initial.current ? initial : await brain.prepare() });
  });
}
