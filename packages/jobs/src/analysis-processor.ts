import { ChecklistItem, HealthSettings, PlaybookStructure, type MeetingType } from "@sci/contracts";
import {
  actionPlans,
  actionTasks,
  and,
  asc,
  auditLogs,
  churnSignals,
  customerHealthSnapshots,
  customers,
  desc,
  eq,
  expansionOpportunities,
  intelligenceIndicators,
  intelligenceSuggestions,
  meetingAnalyses,
  meetingLiveSignals,
  meetingNotes,
  meetings,
  meetingTranscriptSegments,
  ne,
  playbookVersions,
  sql,
  tenantHealthSettings,
  tenantSkillSettings,
  type Database,
  type Tx,
} from "@sci/db";
import {
  analyzeMeeting,
  computeHealth,
  type DecisionProvider,
  type ReasoningProvider,
} from "@sci/intelligence";
import { TenantSkillSettings } from "@sci/contracts";
import { z } from "zod";
import { publishAnalysisToCrm, type CrmPublishDeps } from "./crm-publisher.js";

export const MeetingAnalysisPayload = z.object({
  tenantId: z.uuid(),
  analysisId: z.uuid(),
  requestedBy: z.uuid().nullable(),
});
export type MeetingAnalysisPayload = z.infer<typeof MeetingAnalysisPayload>;

export interface AnalysisDeps {
  database: Database;
  reasoning: ReasoningProvider | null;
  decisions: DecisionProvider | null;
  /** Envio automático ao CRM vinculado após a análise (quando a conexão permitir). */
  crm?: Omit<CrmPublishDeps, "database" | "log">;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export async function loadHealthSettings(tx: Tx): Promise<HealthSettings> {
  const [row] = await tx.select().from(tenantHealthSettings);
  return HealthSettings.safeParse(row?.settings ?? {}).data ?? HealthSettings.parse({});
}

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Modo Análise: consolida a reunião em diagnóstico, indicadores, Customer Health,
 * Churn Radar, oportunidades e plano de ação — tudo com evidência e versionado.
 */
export async function processMeetingAnalysis(
  deps: AnalysisDeps,
  p: MeetingAnalysisPayload,
): Promise<"completed" | "failed" | "skipped"> {
  const ctx = { tenantId: p.tenantId, userId: p.requestedBy };
  const db = deps.database;

  const loaded = await db.withContext(ctx, async (tx) => {
    const [a] = await tx.select().from(meetingAnalyses).where(eq(meetingAnalyses.id, p.analysisId));
    if (!a || a.status !== "processing") return null;
    const [m] = await tx.select().from(meetings).where(eq(meetings.id, a.meetingId));
    if (!m) return null;
    const [pv] = m.playbookVersionId
      ? await tx
          .select({ structure: playbookVersions.structure })
          .from(playbookVersions)
          .where(eq(playbookVersions.id, m.playbookVersionId))
      : [];
    const [cust] = m.customerId
      ? await tx.select().from(customers).where(eq(customers.id, m.customerId))
      : [];
    const [skill] = await tx.select().from(tenantSkillSettings);
    const transcript = await tx
      .select()
      .from(meetingTranscriptSegments)
      .where(eq(meetingTranscriptSegments.meetingId, m.id))
      .orderBy(asc(meetingTranscriptSegments.startMs), asc(meetingTranscriptSegments.id));
    const live = await tx.select().from(meetingLiveSignals).where(eq(meetingLiveSignals.meetingId, m.id));
    const notes = await tx.select().from(meetingNotes).where(eq(meetingNotes.meetingId, m.id));
    const done = await tx
      .select()
      .from(intelligenceSuggestions)
      .where(and(eq(intelligenceSuggestions.meetingId, m.id), eq(intelligenceSuggestions.status, "done")));
    const open = m.customerId
      ? await tx
          .select()
          .from(churnSignals)
          .where(and(eq(churnSignals.customerId, m.customerId), ne(churnSignals.status, "resolved")))
      : [];
    const [prevHealth] = m.customerId
      ? await tx
          .select()
          .from(customerHealthSnapshots)
          .where(eq(customerHealthSnapshots.customerId, m.customerId))
          .orderBy(desc(customerHealthSnapshots.createdAt))
          .limit(1)
      : [];
    return {
      a,
      m,
      pv,
      cust,
      skill,
      transcript,
      live,
      notes,
      done,
      open,
      prevHealth,
      health: await loadHealthSettings(tx),
    };
  });
  if (!loaded) return "skipped";
  const { a, m, cust } = loaded;

  let out;
  try {
    out = await analyzeMeeting(
      {
        meetingType: m.meetingType as MeetingType,
        objective: m.objective,
        playbook: loaded.pv?.structure ? PlaybookStructure.parse(loaded.pv.structure) : null,
        settings:
          TenantSkillSettings.safeParse(loaded.skill?.settings ?? {}).data ?? TenantSkillSettings.parse({}),
        transcript: loaded.transcript.map((s) => ({
          id: s.id,
          speaker: s.speaker,
          text: s.text,
          startMs: s.startMs,
        })),
        liveSignals: loaded.live.map((s) => ({
          kind: s.kind,
          key: s.key,
          label: s.label,
          evidenceSegmentId: s.evidenceSegmentId,
          evidenceText: s.evidenceText,
        })),
        notes: loaded.notes.map((n) => n.text),
        suggestionsDone: loaded.done.map((s) => ({
          question: s.question,
          playbookQuestionKey: s.playbookQuestionKey,
        })),
        checklistOpen: (z.array(ChecklistItem).safeParse(m.checklist).data ?? [])
          .filter((c) => c.status !== "covered")
          .map((c) => ({ label: c.label, required: c.required })),
        openChurn: loaded.open.map((o) => ({
          factorKey: o.factorKey,
          recurrence: o.lastMeetingId === m.id ? o.recurrence - 1 : o.recurrence,
        })),
      },
      { reasoning: deps.reasoning, decisions: deps.decisions },
    );
  } catch (err) {
    await db.withContext(ctx, (tx) =>
      tx
        .update(meetingAnalyses)
        .set({
          status: "failed",
          error: `Falha na análise: ${(err as Error).message}`,
          completedAt: sql`now()`,
        })
        .where(eq(meetingAnalyses.id, a.id)),
    );
    deps.log?.warn({ analysisId: a.id, err: (err as Error).message }, "análise falhou");
    return "failed";
  }

  await db.withContext(ctx, async (tx) => {
    const tenantId = p.tenantId;
    const warnings = [...out.warnings];
    if (!cust)
      warnings.push(
        "Reunião sem cliente vinculado: riscos e oportunidades ficam apenas nesta análise. Vincule um cliente e reanalise para registrá-los no Churn Radar e na carteira.",
      );

    // Versões anteriores desta reunião: itens automáticos ainda intocados são substituídos
    const prev = await tx
      .select({ id: meetingAnalyses.id })
      .from(meetingAnalyses)
      .where(and(eq(meetingAnalyses.meetingId, m.id), ne(meetingAnalyses.id, a.id)));
    for (const old of prev) {
      await tx
        .update(actionTasks)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(actionTasks.meetingId, m.id),
            eq(actionTasks.status, "pending"),
            sql`${actionTasks.planId} IN (SELECT id FROM action_plans WHERE analysis_id = ${old.id})`,
          ),
        );
      await tx
        .update(expansionOpportunities)
        .set({ status: "discarded" })
        .where(and(eq(expansionOpportunities.analysisId, old.id), eq(expansionOpportunities.status, "open")));
    }

    // Indicadores
    for (const i of out.indicators) {
      await tx.insert(intelligenceIndicators).values({
        tenantId,
        analysisId: a.id,
        meetingId: m.id,
        customerId: m.customerId,
        indicator: i.indicator,
        score: i.score,
        confidence: i.confidence,
        rationale: i.rationale,
        evidence: i.evidence,
      });
    }

    if (cust) {
      // Churn Radar: um registro aberto por fator, com recorrência entre reuniões
      for (const r of out.risks) {
        const existing = loaded.open.find((o) => o.factorKey === r.factorKey);
        const revenue =
          (r.severity === "high" || r.severity === "critical") && cust.mrrCents != null && cust.mrrSource
            ? cust.mrrCents
            : null;
        if (existing) {
          const sameMeeting = existing.lastMeetingId === m.id;
          await tx
            .update(churnSignals)
            .set({
              severity: r.severity,
              recurrence: sameMeeting ? existing.recurrence : existing.recurrence + 1,
              status: "open",
              evidence: [...r.evidence, ...(existing.evidence as unknown[])].slice(0, 10),
              recommendation: r.recommendation,
              nextAction: r.nextAction,
              revenueAtRiskCents: revenue,
              lastSeenAt: sql`now()`,
              lastMeetingId: m.id,
              lastAnalysisId: a.id,
            })
            .where(eq(churnSignals.id, existing.id));
        } else {
          await tx.insert(churnSignals).values({
            tenantId,
            customerId: cust.id,
            factorKey: r.factorKey,
            factorLabel: r.label,
            severity: r.severity,
            evidence: r.evidence,
            recommendation: r.recommendation,
            nextAction: r.nextAction,
            revenueAtRiskCents: revenue,
            lastMeetingId: m.id,
            lastAnalysisId: a.id,
          });
        }
      }
      for (const o of out.opportunities) {
        // Mesma oportunidade (cliente + tipo) ainda aberta: reforça a evidência em vez de duplicar
        const [dup] = await tx
          .select({ id: expansionOpportunities.id, evidence: expansionOpportunities.evidence })
          .from(expansionOpportunities)
          .where(
            and(
              eq(expansionOpportunities.customerId, cust.id),
              eq(expansionOpportunities.type, o.type),
              sql`${expansionOpportunities.status} IN ('open','qualified')`,
              ne(expansionOpportunities.meetingId, m.id),
            ),
          );
        if (dup) {
          await tx
            .update(expansionOpportunities)
            .set({
              evidence: [...o.evidence, ...(dup.evidence as unknown[])].slice(0, 10),
              need: o.need,
              nextAction: o.nextAction ?? undefined,
            })
            .where(eq(expansionOpportunities.id, dup.id));
          continue;
        }
        await tx.insert(expansionOpportunities).values({
          tenantId,
          customerId: cust.id,
          meetingId: m.id,
          analysisId: a.id,
          type: o.type,
          typeLabel: o.label,
          need: o.need,
          evidence: o.evidence,
          potentialCents: null,
          product: o.product,
          nextAction: o.nextAction,
          ownerUserId: m.ownerUserId,
        });
      }
      // Customer Health
      const openAfter = await tx
        .select({ factorKey: churnSignals.factorKey, severity: churnSignals.severity })
        .from(churnSignals)
        .where(and(eq(churnSignals.customerId, cust.id), eq(churnSignals.status, "open")));
      const h = computeHealth({
        indicators: out.indicators,
        settings: loaded.health,
        previousScore: loaded.prevHealth?.score ?? null,
        openChurn: openAfter,
      });
      await tx.insert(customerHealthSnapshots).values({
        tenantId,
        customerId: cust.id,
        meetingId: m.id,
        analysisId: a.id,
        score: h.score,
        classification: h.classification,
        factors: h.factors,
        missing: h.missing,
        overrides: h.overrides,
        weights: h.weights,
      });
    }

    // Plano de ação
    if (out.actions.length) {
      const [plan] = await tx
        .insert(actionPlans)
        .values({
          tenantId,
          customerId: m.customerId,
          meetingId: m.id,
          analysisId: a.id,
          title: `Plano de ação — ${m.title ?? "reunião"} (v${a.version})`,
          createdBy: p.requestedBy,
        })
        .returning({ id: actionPlans.id });
      for (const t of out.actions) {
        await tx.insert(actionTasks).values({
          tenantId,
          planId: plan!.id,
          customerId: m.customerId,
          meetingId: m.id,
          title: t.title,
          description: t.description,
          ownerUserId: t.responsibleParty === "internal" ? m.ownerUserId : null,
          responsibleParty: t.responsibleParty,
          dueDate: t.dueInDays != null ? addDays(t.dueInDays) : null,
          priority: t.priority,
          evidence: t.evidence,
          recommendation: t.recommendation,
          createdBy: p.requestedBy,
        });
      }
    }

    await tx
      .update(meetingAnalyses)
      .set({
        status: "completed",
        mode: out.mode,
        summary: out.summary,
        diagnosis: out.diagnosis,
        model: out.model,
        warnings,
        result: {
          objectives: out.objectives,
          questionsAsked: out.questionsAsked,
          unansweredQuestions: out.unansweredQuestions,
          needs: out.needs,
          feedbacks: out.feedbacks,
          recommendations: out.recommendations,
          risks: out.risks,
          opportunities: out.opportunities,
        },
        completedAt: sql`now()`,
      })
      .where(eq(meetingAnalyses.id, a.id));
    await tx.update(meetings).set({ status: "analyzed" }).where(eq(meetings.id, m.id));
    await tx.insert(auditLogs).values({
      tenantId,
      actorUserId: p.requestedBy,
      action: "meeting.analyzed",
      entityType: "meeting_analysis",
      entityId: a.id,
      metadata: {
        mode: out.mode,
        risks: out.risks.length,
        opportunities: out.opportunities.length,
        actions: out.actions.length,
      },
    });
  });
  deps.log?.info({ analysisId: a.id, mode: out.mode }, "reunião analisada");
  // Depois de gravar a análise: envia ao CRM vinculado, se a conexão estiver com envio automático.
  // Falhas no CRM ficam registradas no envio e nunca invalidam a análise.
  if (deps.crm)
    await publishAnalysisToCrm(
      { ...deps.crm, database: db, log: deps.log },
      { tenantId: p.tenantId, analysisId: a.id, trigger: "auto", requestedBy: p.requestedBy },
    ).catch((err: Error) => deps.log?.warn({ analysisId: a.id, err: err.message }, "falha no envio ao CRM"));
  return "completed";
}
