import { CrmConnectionSettings, type CrmEntityType, type CrmProviderKey } from "@sci/contracts";
import { crmClientFactory, idempotencyKey, type CrmClientFactory } from "@sci/crm-hub";
import {
  actionPlans,
  actionTasks,
  and,
  auditLogs,
  crmConnections,
  customerHealthSnapshots,
  eq,
  integrationSyncs,
  meetingAnalyses,
  meetingCrmLinks,
  meetings,
  ne,
  sql,
  type Database,
} from "@sci/db";
import { decryptSecret, type Keyring } from "@sci/security";

/**
 * Envio da análise da reunião ao registro vinculado no CRM:
 *  - comentário com resumo, Customer Health, riscos, oportunidades e próximos passos;
 *  - uma tarefa por ação interna do plano de ação;
 *  - campos de resumo no registro (Customer Health, risco, data da análise).
 *
 * Idempotente: cada análise × registro tem um `integration_syncs`. Em nova tentativa, o que já foi
 * criado (comentário, tarefas) não é repetido. Nenhuma chamada ao CRM acontece dentro de transação.
 */
export interface CrmPublishDeps {
  database: Database;
  keyring: Keyring | null;
  /** URL pública da plataforma, para o link "análise completa". */
  appUrl: string | null;
  factory?: (provider: CrmProviderKey) => CrmClientFactory | null;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export interface CrmPublishRequest {
  tenantId: string;
  analysisId: string;
  trigger: "auto" | "manual";
  requestedBy: string | null;
}

export type CrmPublishOutcome =
  { status: "skipped"; reason: string } | { status: "succeeded" | "failed"; syncId: string; error?: string };

interface PublishResult {
  noteId: string | null;
  /** Tarefas criadas, na ordem de criação (id na plataforma → id no CRM). */
  tasks: { id: string; externalId: string }[];
  fieldsUpdated: string[];
  warnings: string[];
  recordUrl: string | null;
  trigger: "auto" | "manual";
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
};
const SEV_ORDER = ["critical", "high", "medium", "low"];

interface RiskLite {
  label: string;
  severity: string;
  evidence?: { text: string }[];
  recommendation?: string;
}
interface OppLite {
  label: string;
  need: string;
  evidence?: { text: string }[];
}

export function riskLabelOf(risks: RiskLite[]): string {
  const top = [...risks].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))[0];
  return top ? (SEVERITY_LABEL[top.severity] ?? top.severity) : "Sem risco identificado";
}

const fmt10 = (score100: number) =>
  (Math.round(score100) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const quote = (t?: string) => (t ? ` — “${t.length > 180 ? `${t.slice(0, 177)}…` : t}”` : "");

/** Texto do comentário (texto simples: legível em qualquer CRM). */
export function buildCrmComment(i: {
  meetingTitle: string | null;
  meetingDate: string | null;
  summary: string | null;
  diagnosis: string | null;
  healthScore: number | null;
  healthClass: string | null;
  risks: RiskLite[];
  opportunities: OppLite[];
  nextSteps: { title: string; dueDate: string | null }[];
  link: string | null;
}): string {
  const CLASS: Record<string, string> = {
    healthy: "Saudável",
    attention: "Atenção",
    high_risk: "Risco alto",
  };
  const lines: string[] = [];
  lines.push(
    `SCALE CUSTOMER INTELLIGENCE — Análise da reunião${i.meetingTitle ? `: ${i.meetingTitle}` : ""}${
      i.meetingDate ? ` (${i.meetingDate.split("-").reverse().join("/")})` : ""
    }`,
  );
  if (i.healthScore !== null)
    lines.push(
      `Customer Health: ${fmt10(i.healthScore)}/10${i.healthClass ? ` — ${CLASS[i.healthClass] ?? i.healthClass}` : ""}`,
    );
  if (i.summary) lines.push("", "RESUMO", i.summary);
  if (i.diagnosis) lines.push("", "DIAGNÓSTICO", i.diagnosis);
  if (i.risks.length) {
    lines.push("", "RISCOS IDENTIFICADOS");
    for (const r of i.risks)
      lines.push(`• ${r.label} (${SEVERITY_LABEL[r.severity] ?? r.severity})${quote(r.evidence?.[0]?.text)}`);
  }
  if (i.opportunities.length) {
    lines.push("", "OPORTUNIDADES");
    for (const o of i.opportunities) lines.push(`• ${o.label}: ${o.need}${quote(o.evidence?.[0]?.text)}`);
  }
  if (i.nextSteps.length) {
    lines.push("", "PRÓXIMOS PASSOS");
    for (const t of i.nextSteps)
      lines.push(`• ${t.title}${t.dueDate ? ` (até ${t.dueDate.split("-").reverse().join("/")})` : ""}`);
  }
  if (i.link) lines.push("", `Análise completa: ${i.link}`);
  return lines.join("\n").slice(0, 60_000);
}

export async function publishAnalysisToCrm(
  deps: CrmPublishDeps,
  req: CrmPublishRequest,
): Promise<CrmPublishOutcome> {
  const ctx = { tenantId: req.tenantId, userId: req.requestedBy };
  const db = deps.database;
  const factoryOf = deps.factory ?? crmClientFactory;

  /* 1) Carrega tudo e reserva o envio (transação curta, sem rede). */
  const prep = await db.withContext(ctx, async (tx) => {
    const [a] = await tx.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, req.analysisId));
    if (!a || a.status !== "completed") return { skip: "Análise não concluída" } as const;
    const [m] = await tx.select().from(meetings).where(eq(meetings.id, a.meetingId));
    if (!m) return { skip: "Reunião não encontrada" } as const;
    const [link] = await tx
      .select()
      .from(meetingCrmLinks)
      .where(and(eq(meetingCrmLinks.meetingId, m.id), eq(meetingCrmLinks.active, true)));
    if (!link) return { skip: "Reunião sem registro do CRM vinculado" } as const;
    if (!link.connectionId) return { skip: "Vínculo sem conexão do CRM" } as const;
    const [conn] = await tx.select().from(crmConnections).where(eq(crmConnections.id, link.connectionId));
    if (!conn || conn.status !== "active" || !conn.encryptedCredentials)
      return { skip: "Conexão do CRM não está ativa" } as const;
    const settings = CrmConnectionSettings.parse(conn.settings ?? {});
    if (req.trigger === "auto" && !settings.autoPublish)
      return { skip: "Envio automático desligado" } as const;
    const factory = factoryOf(conn.provider);
    if (!factory) return { skip: "Integração com este CRM ainda não disponível" } as const;
    if (!deps.keyring) return { skip: "Chave de cifra das credenciais não configurada" } as const;

    const key = idempotencyKey("crm.publish", a.id, link.provider, link.entityType, link.externalRecordId);
    const [existing] = await tx
      .select()
      .from(integrationSyncs)
      .where(eq(integrationSyncs.idempotencyKey, key));
    if (existing?.status === "succeeded") return { skip: "Esta análise já foi enviada ao CRM" } as const;
    if (existing?.status === "running" && Date.now() - new Date(existing.updatedAt).getTime() < 5 * 60_000)
      return { skip: "Envio em andamento" } as const;

    const [snap] = await tx
      .select({
        score: customerHealthSnapshots.score,
        classification: customerHealthSnapshots.classification,
      })
      .from(customerHealthSnapshots)
      .where(eq(customerHealthSnapshots.analysisId, a.id));
    const tasks = await tx
      .select({
        id: actionTasks.id,
        title: actionTasks.title,
        description: actionTasks.description,
        dueDate: actionTasks.dueDate,
        party: actionTasks.responsibleParty,
      })
      .from(actionTasks)
      .innerJoin(actionPlans, eq(actionPlans.id, actionTasks.planId))
      .where(and(eq(actionPlans.analysisId, a.id), ne(actionTasks.status, "cancelled")))
      .orderBy(sql`${actionTasks.dueDate} ASC NULLS LAST`, actionTasks.title);

    const previous = (existing?.resultSummary ?? null) as Partial<PublishResult> | null;
    const summary = {
      provider: conn.provider,
      entityType: link.entityType,
      externalRecordId: link.externalRecordId,
      trigger: req.trigger,
    };
    let syncId: string;
    if (existing) {
      await tx
        .update(integrationSyncs)
        .set({ status: "running", attempts: sql`${integrationSyncs.attempts} + 1`, error: null })
        .where(eq(integrationSyncs.id, existing.id));
      syncId = existing.id;
    } else {
      const [row] = await tx
        .insert(integrationSyncs)
        .values({
          tenantId: req.tenantId,
          connectionId: conn.id,
          meetingId: m.id,
          analysisId: a.id,
          operation: "crm.publish_analysis",
          idempotencyKey: key,
          status: "running",
          attempts: 1,
          requestSummary: summary,
          requestedBy: req.requestedBy,
          approvedBy: req.trigger === "manual" ? req.requestedBy : null,
        })
        .returning({ id: integrationSyncs.id });
      syncId = row!.id;
    }
    const result = (a.result ?? {}) as { risks?: RiskLite[]; opportunities?: OppLite[] };
    return {
      syncId,
      settings,
      factory,
      conn,
      link,
      previous,
      meeting: m,
      analysis: a,
      health: snap ?? null,
      risks: result.risks ?? [],
      opportunities: result.opportunities ?? [],
      tasks,
    } as const;
  });
  if ("skip" in prep) {
    deps.log?.info({ analysisId: req.analysisId, reason: prep.skip }, "envio ao CRM ignorado");
    return { status: "skipped", reason: prep.skip! };
  }

  /* 2) Chamadas ao CRM, passo a passo; o que já foi feito numa tentativa anterior não se repete. */
  const out: PublishResult = {
    noteId: prep.previous?.noteId ?? null,
    tasks: Array.isArray(prep.previous?.tasks) ? [...prep.previous.tasks] : [],
    fieldsUpdated: [],
    warnings: [],
    recordUrl: prep.link.recordUrl,
    trigger: req.trigger,
  };
  const errors: string[] = [];
  const entity = prep.link.entityType as CrmEntityType;
  const recordId = prep.link.externalRecordId;
  const snapshotOwner = (prep.link.recordSnapshot as { owner?: { id?: string } } | null)?.owner?.id ?? null;
  const internalTasks = prep.tasks.filter((t) => t.party === "internal");
  let client;
  try {
    client = prep.factory({
      externalAccountId: prep.conn.externalAccountId,
      secret: decryptSecret(prep.conn.encryptedCredentials!, deps.keyring!, req.tenantId),
      authType: prep.conn.authType,
    });
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (client) {
    const meetingDate = (prep.meeting.startedAt ?? prep.meeting.createdAt).slice(0, 10);
    if (prep.settings.publishComment && !out.noteId) {
      try {
        const body = buildCrmComment({
          meetingTitle: prep.meeting.title,
          meetingDate,
          summary: prep.analysis.summary,
          diagnosis: prep.analysis.diagnosis,
          healthScore: prep.health?.score ?? null,
          healthClass: prep.health?.classification ?? null,
          risks: prep.risks,
          opportunities: prep.opportunities,
          nextSteps: internalTasks.map((t) => ({ title: t.title, dueDate: t.dueDate })),
          link: deps.appUrl ? `${deps.appUrl.replace(/\/$/, "")}/app/calls/${prep.meeting.id}` : null,
        });
        const [title, ...rest] = body.split("\n");
        out.noteId = (
          await client.publishNote(
            entity,
            recordId,
            { title: title!, body: rest.join("\n").trim() },
            syncKey(prep.syncId, "note"),
          )
        ).externalNoteId;
      } catch (e) {
        errors.push(`Comentário: ${(e as Error).message}`);
      }
    }
    if (prep.settings.publishTasks) {
      for (const t of internalTasks) {
        if (out.tasks.some((x) => x.id === t.id)) continue;
        try {
          const externalId = (
            await client.createTask(
              entity,
              recordId,
              {
                title: t.title,
                description: t.description,
                dueDate: t.dueDate,
                ownerExternalId: snapshotOwner,
              },
              syncKey(prep.syncId, t.id),
            )
          ).externalTaskId;
          out.tasks.push({ id: t.id, externalId });
        } catch (e) {
          errors.push(`Tarefa "${t.title}": ${(e as Error).message}`);
        }
      }
    }
    if (prep.settings.publishFields && client.updateSummaryFields) {
      try {
        const r = await client.updateSummaryFields(entity, recordId, {
          healthScore10: prep.health?.score == null ? null : Math.round(prep.health.score) / 10,
          riskLabel: riskLabelOf(prep.risks),
          analyzedAt: new Date(prep.analysis.completedAt ?? Date.now()).toISOString(),
        });
        out.fieldsUpdated = r.fields;
        out.warnings.push(...r.warnings);
      } catch (e) {
        errors.push(`Campos: ${(e as Error).message}`);
      }
    }
  }

  /* 3) Registra o resultado. */
  const status = errors.length ? "failed" : "succeeded";
  await db.withContext(ctx, async (tx) => {
    await tx
      .update(integrationSyncs)
      .set({
        status,
        resultSummary: out as unknown as Record<string, unknown>,
        error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
      })
      .where(eq(integrationSyncs.id, prep.syncId));
    await tx.insert(auditLogs).values({
      tenantId: req.tenantId,
      actorUserId: req.requestedBy,
      action: status === "succeeded" ? "crm.publish.succeeded" : "crm.publish.failed",
      entityType: "integration_sync",
      entityId: prep.syncId,
      metadata: {
        trigger: req.trigger,
        provider: prep.conn.provider,
        record: `${entity}:${recordId}`,
        note: !!out.noteId,
        tasks: out.tasks.length,
        fields: out.fieldsUpdated,
      },
    });
  });
  if (errors.length) deps.log?.warn({ syncId: prep.syncId, errors }, "envio ao CRM com falhas");
  return errors.length
    ? { status: "failed", syncId: prep.syncId, error: errors.join(" | ") }
    : { status: "succeeded", syncId: prep.syncId };
}

const syncKey = (syncId: string, part: string) => idempotencyKey("crm.publish.step", syncId, part);
