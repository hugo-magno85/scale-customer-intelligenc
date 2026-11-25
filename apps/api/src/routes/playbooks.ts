import { createHash } from "node:crypto";
import {
  CreateManualVersionRequest,
  CreatePlaybookRequest,
  Playbook,
  PLAYBOOK_MAX_FILE_BYTES,
  PLAYBOOK_MAX_FILES,
  PlaybookStructure,
  PlaybookVersion,
  UpdatePlaybookRequest,
  UpdateVersionStructureRequest,
  type PlaybookVersionStatus,
} from "@sci/contracts";
import {
  and,
  desc,
  eq,
  playbookCriteria,
  playbookDocuments,
  playbookQuestions,
  playbooks,
  playbookVersions,
  sql,
  type Tx,
} from "@sci/db";
import { ensureSkillVersion } from "@sci/jobs";
import { detectKind } from "@sci/playbooks";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound, pgCode } from "../lib/errors.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

const Id = z.object({ id: z.uuid() });

const KIND_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
};

async function getPlaybook(tx: Tx, id: string): Promise<Playbook> {
  const [p] = await tx.select().from(playbooks).where(eq(playbooks.id, id));
  if (!p) throw notFound("Playbook");
  const versions = await tx
    .select({ id: playbookVersions.id, number: playbookVersions.number, status: playbookVersions.status })
    .from(playbookVersions)
    .where(eq(playbookVersions.playbookId, id))
    .orderBy(desc(playbookVersions.number));
  const published = versions.find((v) => v.status === "published");
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    meetingType: p.meetingType as Playbook["meetingType"],
    journeyStage: p.journeyStage,
    segment: p.segment,
    operation: p.operation,
    active: p.active,
    publishedVersionId: published?.id ?? null,
    publishedVersionNumber: published?.number ?? null,
    latestVersionStatus: versions[0]?.status ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function getVersion(tx: Tx, id: string): Promise<PlaybookVersion> {
  const [v] = await tx.select().from(playbookVersions).where(eq(playbookVersions.id, id));
  if (!v) throw notFound("Versão");
  const docs = await tx
    .select({
      id: playbookDocuments.id,
      filename: playbookDocuments.filename,
      mimeType: playbookDocuments.mimeType,
      sizeBytes: playbookDocuments.sizeBytes,
      sha256: playbookDocuments.sha256,
      extractedChars: playbookDocuments.extractedChars,
      createdAt: playbookDocuments.createdAt,
    })
    .from(playbookDocuments)
    .where(eq(playbookDocuments.versionId, id))
    .orderBy(playbookDocuments.createdAt);
  return {
    id: v.id,
    playbookId: v.playbookId,
    number: v.number,
    status: v.status,
    source: v.source,
    structure: v.structure == null ? null : PlaybookStructure.parse(v.structure),
    processingError: v.processingError,
    processingWarnings: v.processingWarnings,
    interpretationModel: v.interpretationModel,
    skillVersion: v.skillVersion,
    createdBy: v.createdBy,
    approvedBy: v.approvedBy,
    approvedAt: v.approvedAt,
    publishedAt: v.publishedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    documents: docs,
  };
}

async function nextNumber(tx: Tx, playbookId: string) {
  // trava o playbook para numeração sem corrida
  await tx.execute(sql`SELECT 1 FROM playbooks WHERE id = ${playbookId} FOR UPDATE`);
  const [r] = await tx
    .select({ n: sql<number>`coalesce(max(${playbookVersions.number}), 0) + 1` })
    .from(playbookVersions)
    .where(eq(playbookVersions.playbookId, playbookId));
  return Number(r?.n ?? 1);
}

function assertStatus(current: PlaybookVersionStatus, allowed: PlaybookVersionStatus[], action: string) {
  if (!allowed.includes(current))
    throw conflict(`Não é possível ${action} uma versão com status "${current}"`);
}

export async function playbookRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/playbooks",
    {
      schema: { tags: ["playbooks"], response: { 200: z.array(Playbook) } },
      preHandler: requirePermission("playbooks.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const rows = await tx.select({ id: playbooks.id }).from(playbooks).orderBy(playbooks.name);
        return Promise.all(rows.map((r) => getPlaybook(tx, r.id)));
      }),
  );

  app.post(
    "/playbooks",
    {
      schema: { tags: ["playbooks"], body: CreatePlaybookRequest, response: { 201: Playbook } },
      preHandler: requirePermission("playbooks.manage"),
    },
    async (req, reply) => {
      const b = req.body;
      try {
        const p = await tenantTx(req, async (tx) => {
          const [row] = await tx
            .insert(playbooks)
            .values({
              tenantId: req.tenant!.tenantId,
              name: b.name,
              description: b.description ?? null,
              meetingType: b.meetingType,
              journeyStage: b.journeyStage ?? null,
              segment: b.segment ?? null,
              operation: b.operation ?? null,
              createdBy: req.auth!.userId,
            })
            .returning({ id: playbooks.id });
          await audit(tx, req, {
            action: "playbook.created",
            entityType: "playbook",
            entityId: row!.id,
            metadata: { name: b.name },
          });
          return getPlaybook(tx, row!.id);
        });
        return reply.status(201).send(p);
      } catch (err) {
        if (pgCode(err) === "23505") throw conflict("Já existe um playbook com este nome");
        throw err;
      }
    },
  );

  app.get(
    "/playbooks/:id",
    {
      schema: { tags: ["playbooks"], params: Id, response: { 200: Playbook } },
      preHandler: requirePermission("playbooks.read"),
    },
    async (req) => tenantTx(req, (tx) => getPlaybook(tx, req.params.id)),
  );

  app.patch(
    "/playbooks/:id",
    {
      schema: { tags: ["playbooks"], params: Id, body: UpdatePlaybookRequest, response: { 200: Playbook } },
      preHandler: requirePermission("playbooks.manage"),
    },
    async (req) => {
      const b = req.body;
      const patch: Partial<typeof playbooks.$inferInsert> = {};
      for (const k of ["name", "meetingType", "active"] as const)
        if (b[k] !== undefined) (patch as Record<string, unknown>)[k] = b[k];
      for (const k of ["description", "journeyStage", "segment", "operation"] as const)
        if (b[k] !== undefined) patch[k] = b[k] ?? null;
      try {
        return await tenantTx(req, async (tx) => {
          await getPlaybook(tx, req.params.id);
          if (Object.keys(patch).length)
            await tx.update(playbooks).set(patch).where(eq(playbooks.id, req.params.id));
          const action =
            b.active === false
              ? "playbook.deactivated"
              : b.active === true
                ? "playbook.activated"
                : "playbook.updated";
          await audit(tx, req, {
            action,
            entityType: "playbook",
            entityId: req.params.id,
            metadata: { changed: Object.keys(patch) },
          });
          return getPlaybook(tx, req.params.id);
        });
      } catch (err) {
        if (pgCode(err) === "23505") throw conflict("Já existe um playbook com este nome");
        throw err;
      }
    },
  );

  app.get(
    "/playbooks/:id/versions",
    {
      schema: { tags: ["playbooks"], params: Id, response: { 200: z.array(PlaybookVersion) } },
      preHandler: requirePermission("playbooks.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        await getPlaybook(tx, req.params.id);
        const rows = await tx
          .select({ id: playbookVersions.id })
          .from(playbookVersions)
          .where(eq(playbookVersions.playbookId, req.params.id))
          .orderBy(desc(playbookVersions.number));
        return Promise.all(rows.map((r) => getVersion(tx, r.id)));
      }),
  );

  app.get(
    "/playbook-versions/:id",
    {
      schema: { tags: ["playbooks"], params: Id, response: { 200: PlaybookVersion } },
      preHandler: requirePermission("playbooks.read"),
    },
    async (req) => tenantTx(req, (tx) => getVersion(tx, req.params.id)),
  );

  // Cadastro manual ---------------------------------------------------------
  app.post(
    "/playbooks/:id/versions/manual",
    {
      schema: {
        tags: ["playbooks"],
        params: Id,
        body: CreateManualVersionRequest,
        response: { 201: PlaybookVersion },
      },
      preHandler: requirePermission("playbooks.manage"),
    },
    async (req, reply) => {
      const v = await tenantTx(req, async (tx) => {
        await getPlaybook(tx, req.params.id);
        const number = await nextNumber(tx, req.params.id);
        const skillVersion = await ensureSkillVersion(tx);
        const [row] = await tx
          .insert(playbookVersions)
          .values({
            tenantId: req.tenant!.tenantId,
            playbookId: req.params.id,
            number,
            status: "draft",
            source: "manual",
            structure: req.body.structure,
            skillVersion,
            createdBy: req.auth!.userId,
          })
          .returning({ id: playbookVersions.id });
        await audit(tx, req, {
          action: "playbook.version.created",
          entityType: "playbook_version",
          entityId: row!.id,
          metadata: { source: "manual", number },
        });
        return getVersion(tx, row!.id);
      });
      return reply.status(201).send(v);
    },
  );

  // Nova versão a partir de outra (para evoluir uma versão publicada) --------
  app.post(
    "/playbook-versions/:id/clone",
    {
      schema: { tags: ["playbooks"], params: Id, response: { 201: PlaybookVersion } },
      preHandler: requirePermission("playbooks.manage"),
    },
    async (req, reply) => {
      const v = await tenantTx(req, async (tx) => {
        const src = await getVersion(tx, req.params.id);
        if (!src.structure) throw badRequest("A versão de origem não tem estrutura");
        const number = await nextNumber(tx, src.playbookId);
        const [row] = await tx
          .insert(playbookVersions)
          .values({
            tenantId: req.tenant!.tenantId,
            playbookId: src.playbookId,
            number,
            status: "draft",
            source: "manual",
            structure: src.structure,
            skillVersion: await ensureSkillVersion(tx),
            createdBy: req.auth!.userId,
          })
          .returning({ id: playbookVersions.id });
        await audit(tx, req, {
          action: "playbook.version.cloned",
          entityType: "playbook_version",
          entityId: row!.id,
          metadata: { from: src.id, number },
        });
        return getVersion(tx, row!.id);
      });
      return reply.status(201).send(v);
    },
  );

  // Upload de documentos ------------------------------------------------------
  app.post(
    "/playbooks/:id/versions/upload",
    {
      schema: { tags: ["playbooks"], params: Id, response: { 202: PlaybookVersion } },
      preHandler: requirePermission("playbooks.manage"),
      bodyLimit: PLAYBOOK_MAX_FILE_BYTES * PLAYBOOK_MAX_FILES + 1024 * 1024,
    },
    async (req, reply) => {
      if (!req.isMultipart()) throw badRequest("Envie os arquivos como multipart/form-data");
      const files: { filename: string; mime: string; buf: Buffer }[] = [];
      for await (const part of req.files({
        limits: { fileSize: PLAYBOOK_MAX_FILE_BYTES, files: PLAYBOOK_MAX_FILES },
      })) {
        const buf = await part.toBuffer();
        if (part.file.truncated) throw badRequest(`"${part.filename}" excede o limite de 15 MB`);
        const filename = part.filename.replace(/[\\/]/g, "_").slice(0, 255);
        const kind = detectKind(filename, buf);
        if (!kind)
          throw badRequest(`"${filename}": formato não suportado (use PDF, DOCX, PPTX, XLSX, TXT ou MD)`);
        files.push({ filename, mime: KIND_MIME[kind]!, buf });
      }
      if (!files.length) throw badRequest("Nenhum arquivo enviado");
      const version = await tenantTx(req, async (tx) => {
        await getPlaybook(tx, req.params.id);
        const number = await nextNumber(tx, req.params.id);
        const [row] = await tx
          .insert(playbookVersions)
          .values({
            tenantId: req.tenant!.tenantId,
            playbookId: req.params.id,
            number,
            status: "processing",
            source: "upload",
            createdBy: req.auth!.userId,
          })
          .returning({ id: playbookVersions.id });
        for (const f of files) {
          await tx.insert(playbookDocuments).values({
            tenantId: req.tenant!.tenantId,
            versionId: row!.id,
            filename: f.filename,
            mimeType: f.mime,
            sizeBytes: f.buf.length,
            sha256: createHash("sha256").update(f.buf).digest("hex"),
            content: f.buf,
            createdBy: req.auth!.userId,
          });
        }
        await audit(tx, req, {
          action: "playbook.version.uploaded",
          entityType: "playbook_version",
          entityId: row!.id,
          metadata: { number, files: files.map((f) => ({ name: f.filename, size: f.buf.length })) },
        });
        return row!.id;
      });
      await app.jobs.processPlaybookVersion({
        tenantId: req.tenant!.tenantId,
        versionId: version,
        requestedBy: req.auth!.userId,
      });
      return reply.status(202).send(await tenantTx(req, (tx) => getVersion(tx, version)));
    },
  );

  app.post(
    "/playbook-versions/:id/reprocess",
    {
      schema: { tags: ["playbooks"], params: Id, response: { 202: PlaybookVersion } },
      preHandler: requirePermission("playbooks.manage"),
    },
    async (req, reply) => {
      await tenantTx(req, async (tx) => {
        const v = await getVersion(tx, req.params.id);
        assertStatus(v.status, ["failed"], "reprocessar");
        if (v.source !== "upload")
          throw badRequest("Apenas versões enviadas por upload podem ser reprocessadas");
        await tx
          .update(playbookVersions)
          .set({ status: "processing", processingError: null })
          .where(eq(playbookVersions.id, v.id));
        await audit(tx, req, {
          action: "playbook.version.reprocess",
          entityType: "playbook_version",
          entityId: v.id,
        });
      });
      await app.jobs.processPlaybookVersion({
        tenantId: req.tenant!.tenantId,
        versionId: req.params.id,
        requestedBy: req.auth!.userId,
      });
      return reply.status(202).send(await tenantTx(req, (tx) => getVersion(tx, req.params.id)));
    },
  );

  // Revisão e edição ----------------------------------------------------------
  app.put(
    "/playbook-versions/:id/structure",
    {
      schema: {
        tags: ["playbooks"],
        params: Id,
        body: UpdateVersionStructureRequest,
        response: { 200: PlaybookVersion },
      },
      preHandler: requirePermission("playbooks.manage"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const v = await getVersion(tx, req.params.id);
        assertStatus(v.status, ["draft", "in_review"], "editar");
        await tx
          .update(playbookVersions)
          .set({ structure: req.body.structure })
          .where(eq(playbookVersions.id, v.id));
        await audit(tx, req, {
          action: "playbook.version.edited",
          entityType: "playbook_version",
          entityId: v.id,
          metadata: { questions: req.body.structure.questions.length },
        });
        return getVersion(tx, v.id);
      }),
  );

  const transition = (
    path: string,
    perm: "playbooks.manage" | "playbooks.approve",
    from: PlaybookVersionStatus[],
    verb: string,
    apply: (tx: Tx, v: PlaybookVersion, userId: string, tenantId: string) => Promise<void>,
    action: string,
  ) =>
    app.post(
      `/playbook-versions/:id/${path}`,
      {
        schema: { tags: ["playbooks"], params: Id, response: { 200: PlaybookVersion } },
        preHandler: requirePermission(perm),
      },
      async (req) =>
        tenantTx(req, async (tx) => {
          await tx.execute(sql`SELECT 1 FROM playbook_versions WHERE id = ${req.params.id} FOR UPDATE`);
          const v = await getVersion(tx, req.params.id);
          assertStatus(v.status, from, verb);
          await apply(tx, v, req.auth!.userId, req.tenant!.tenantId);
          await audit(tx, req, {
            action,
            entityType: "playbook_version",
            entityId: v.id,
            metadata: { number: v.number },
          });
          return getVersion(tx, v.id);
        }),
    );

  transition(
    "submit",
    "playbooks.manage",
    ["draft"],
    "enviar para revisão",
    async (tx, v) => {
      if (!v.structure?.questions.length)
        throw badRequest("Inclua ao menos uma pergunta antes de enviar para revisão");
      await tx.update(playbookVersions).set({ status: "in_review" }).where(eq(playbookVersions.id, v.id));
    },
    "playbook.version.submitted",
  );

  transition(
    "reject",
    "playbooks.approve",
    ["in_review", "approved"],
    "devolver",
    async (tx, v) => {
      await tx
        .update(playbookVersions)
        .set({ status: "draft", approvedBy: null, approvedAt: null })
        .where(eq(playbookVersions.id, v.id));
    },
    "playbook.version.rejected",
  );

  transition(
    "approve",
    "playbooks.approve",
    ["in_review"],
    "aprovar",
    async (tx, v, userId) => {
      if (!v.structure?.questions.length) throw badRequest("A versão precisa de ao menos uma pergunta");
      await tx
        .update(playbookVersions)
        .set({ status: "approved", approvedBy: userId, approvedAt: sql`now()` })
        .where(eq(playbookVersions.id, v.id));
    },
    "playbook.version.approved",
  );

  transition(
    "publish",
    "playbooks.approve",
    ["approved"],
    "publicar",
    async (tx, v, _userId, tenantId) => {
      // arquiva a publicada anterior e publica esta (índice único garante uma só)
      await tx
        .update(playbookVersions)
        .set({ status: "archived" })
        .where(and(eq(playbookVersions.playbookId, v.playbookId), eq(playbookVersions.status, "published")));
      await tx
        .update(playbookVersions)
        .set({ status: "published", publishedAt: sql`now()` })
        .where(eq(playbookVersions.id, v.id));
      const s = v.structure!;
      if (s.questions.length) {
        await tx.insert(playbookQuestions).values(
          s.questions.map((q, i) => ({
            tenantId,
            versionId: v.id,
            key: q.key,
            text: q.text,
            type: q.type,
            indicator: q.indicator,
            priority: q.priority,
            stageKey: q.stageKey,
            weight: q.weight,
            required: q.required,
            position: i,
          })),
        );
      }
      if (s.criteria.length) {
        await tx.insert(playbookCriteria).values(
          s.criteria.map((c) => ({
            tenantId,
            versionId: v.id,
            key: c.key,
            name: c.name,
            description: c.description,
            indicator: c.indicator,
            weight: c.weight,
          })),
        );
      }
    },
    "playbook.version.published",
  );
}
