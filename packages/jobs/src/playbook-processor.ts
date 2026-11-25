import { auditLogs, and, eq, playbookDocuments, playbooks, playbookVersions, type Database } from "@sci/db";
import { interpretPlaybook, type DecisionProvider, type ReasoningProvider } from "@sci/intelligence";
import { ExtractionError, extractText } from "@sci/playbooks";
import type { MeetingType } from "@sci/contracts";
import type { PlaybookProcessPayload } from "./queues.js";
import { ensureSkillVersion } from "./skill-registry.js";

export interface ProcessorDeps {
  database: Database;
  reasoning: ReasoningProvider | null;
  decisions: DecisionProvider | null;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export type ProcessOutcome = "in_review" | "failed" | "skipped";

/**
 * Upload → extração → interpretação (DeepSeek + Jev) → estruturação → revisão.
 * Idempotente: só processa versões em status "processing".
 */
export async function processPlaybookVersion(
  deps: ProcessorDeps,
  p: PlaybookProcessPayload,
): Promise<ProcessOutcome> {
  const ctx = { tenantId: p.tenantId, userId: p.requestedBy };
  const { database } = deps;

  const fail = async (message: string) => {
    await database.withContext(ctx, async (tx) => {
      await tx
        .update(playbookVersions)
        .set({ status: "failed", processingError: message })
        .where(eq(playbookVersions.id, p.versionId));
      await tx.insert(auditLogs).values({
        tenantId: p.tenantId,
        actorUserId: p.requestedBy,
        action: "playbook.version.processing_failed",
        entityType: "playbook_version",
        entityId: p.versionId,
        metadata: { reason: message },
      });
    });
    deps.log?.warn({ versionId: p.versionId, reason: message }, "processamento de playbook falhou");
    return "failed" as const;
  };

  const loaded = await database.withContext(ctx, async (tx) => {
    const [v] = await tx
      .select({
        status: playbookVersions.status,
        playbookName: playbooks.name,
        meetingType: playbooks.meetingType,
      })
      .from(playbookVersions)
      .innerJoin(playbooks, eq(playbooks.id, playbookVersions.playbookId))
      .where(eq(playbookVersions.id, p.versionId));
    if (!v || v.status !== "processing") return null;
    const docs = await tx
      .select()
      .from(playbookDocuments)
      .where(eq(playbookDocuments.versionId, p.versionId));
    return { v, docs };
  });
  if (!loaded) return "skipped";

  // 1–2. Extração (persistida para auditoria e reprocessamento)
  const texts: { filename: string; text: string }[] = [];
  const warnings: string[] = [];
  for (const d of loaded.docs) {
    let text = d.extractedText;
    if (text == null) {
      try {
        const r = await extractText(d.filename, new Uint8Array(d.content));
        text = r.text;
        if (r.truncated) warnings.push(`"${d.filename}" é muito extenso; apenas o início foi considerado.`);
        await database.withContext(ctx, (tx) =>
          tx
            .update(playbookDocuments)
            .set({ extractedText: text, extractedChars: text!.length })
            .where(and(eq(playbookDocuments.id, d.id))),
        );
      } catch (err) {
        if (err instanceof ExtractionError) return fail(`"${d.filename}": ${err.message}`);
        throw err;
      }
    }
    texts.push({ filename: d.filename, text });
  }
  if (!texts.length) return fail("nenhum documento enviado");

  // 3–4. Interpretação e estruturação
  if (!deps.reasoning) {
    return fail(
      "Interpretação indisponível: o provedor DeepSeek não está configurado neste ambiente. O texto foi extraído; reprocesse quando a chave estiver configurada ou crie a versão manualmente.",
    );
  }
  let result;
  try {
    result = await interpretPlaybook(
      {
        playbookName: loaded.v.playbookName,
        meetingType: loaded.v.meetingType as MeetingType,
        documents: texts,
      },
      { reasoning: deps.reasoning, decisions: deps.decisions },
    );
  } catch (err) {
    return fail(`falha na interpretação: ${(err as Error).message}`);
  }

  // 5. Pronto para revisão humana
  await database.withContext(ctx, async (tx) => {
    const skillVersion = await ensureSkillVersion(tx);
    await tx
      .update(playbookVersions)
      .set({
        status: "in_review",
        structure: result.structure,
        processingError: null,
        processingWarnings: [...warnings, ...result.warnings].slice(0, 50),
        interpretationModel: result.model,
        interpretationUsage: { ...result.usage, classification: result.classification },
        skillVersion,
      })
      .where(and(eq(playbookVersions.id, p.versionId), eq(playbookVersions.status, "processing")));
    await tx.insert(auditLogs).values({
      tenantId: p.tenantId,
      actorUserId: p.requestedBy,
      action: "playbook.version.interpreted",
      entityType: "playbook_version",
      entityId: p.versionId,
      metadata: { model: result.model, questions: result.structure.questions.length },
    });
  });
  deps.log?.info(
    { versionId: p.versionId, questions: result.structure.questions.length },
    "playbook interpretado",
  );
  return "in_review";
}
