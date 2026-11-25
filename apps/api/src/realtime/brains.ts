import {
  ChecklistItem,
  PlaybookStructure,
  type LiveSignal,
  type MeetingType,
  type Suggestion,
} from "@sci/contracts";
import {
  asc,
  customers,
  eq,
  intelligenceSuggestions,
  meetingLiveSignals,
  meetings,
  meetingTranscriptSegments,
  playbookVersions,
  sql,
  type Database,
} from "@sci/db";
import { MeetingBrain, type DecisionProvider, type ReasoningProvider } from "@sci/intelligence";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { loadSkillSettings } from "../routes/skill.js";

interface Ctx {
  tenantId: string;
  userId: string;
}

/**
 * Mantém um MeetingBrain por reunião ativa neste processo, restaurado do banco
 * quando necessário (reconexão, reinício). Todas as gravações passam por RLS.
 */
export class BrainManager {
  private brains = new Map<string, { brain: MeetingBrain; tenantId: string; lastUsed: number }>();
  private loading = new Map<string, Promise<MeetingBrain>>();

  constructor(
    private readonly database: Database,
    private readonly providers: () => {
      reasoning: ReasoningProvider | null;
      decisions: DecisionProvider | null;
    },
    private readonly log: FastifyBaseLogger,
  ) {
    // Libera cérebros ociosos (reuniões abandonadas) após 3 h
    setInterval(() => {
      const limit = Date.now() - 3 * 3600_000;
      for (const [id, b] of this.brains) if (b.lastUsed < limit) this.brains.delete(id);
    }, 10 * 60_000).unref();
  }

  async get(meetingId: string, ctx: Ctx): Promise<MeetingBrain> {
    const hit = this.brains.get(meetingId);
    if (hit) {
      if (hit.tenantId !== ctx.tenantId) throw new Error("tenant inconsistente");
      hit.lastUsed = Date.now();
      return hit.brain;
    }
    let p = this.loading.get(meetingId);
    if (!p) {
      p = this.load(meetingId, ctx).finally(() => this.loading.delete(meetingId));
      this.loading.set(meetingId, p);
    }
    return p;
  }

  drop(meetingId: string) {
    this.brains.get(meetingId)?.brain.end();
    this.brains.delete(meetingId);
  }

  private async load(meetingId: string, ctx: Ctx): Promise<MeetingBrain> {
    const db = this.database;
    const data = await db.withContext(ctx, async (tx) => {
      const [m] = await tx
        .select({
          m: meetings,
          customerName: customers.name,
          customerSegment: customers.segment,
          structure: playbookVersions.structure,
        })
        .from(meetings)
        .leftJoin(customers, eq(customers.id, meetings.customerId))
        .leftJoin(playbookVersions, eq(playbookVersions.id, meetings.playbookVersionId))
        .where(eq(meetings.id, meetingId));
      if (!m) throw new Error("reunião não encontrada");
      const settings = await loadSkillSettings(tx);
      const sugg = await tx
        .select()
        .from(intelligenceSuggestions)
        .where(eq(intelligenceSuggestions.meetingId, meetingId))
        .orderBy(asc(intelligenceSuggestions.createdAt));
      const sigs = await tx
        .select()
        .from(meetingLiveSignals)
        .where(eq(meetingLiveSignals.meetingId, meetingId))
        .orderBy(asc(meetingLiveSignals.createdAt));
      const segs = await tx
        .select()
        .from(meetingTranscriptSegments)
        .where(eq(meetingTranscriptSegments.meetingId, meetingId))
        .orderBy(asc(meetingTranscriptSegments.startMs))
        .limit(400);
      // Histórico do cliente: sinais de reuniões anteriores (base da Etapa 5)
      const history: string[] = [];
      if (m.m.customerId) {
        const prev = await tx.execute<{ label: string; n: number }>(sql`
          SELECT s.label, count(*)::int AS n FROM meeting_live_signals s
          JOIN meetings mm ON mm.id = s.meeting_id
          WHERE mm.customer_id = ${m.m.customerId} AND mm.id <> ${meetingId} AND s.kind = 'risk'
          GROUP BY s.label ORDER BY n DESC LIMIT 3`);
        for (const r of prev.rows)
          history.push(`Histórico: "${r.label}" apareceu em ${r.n} reunião(ões) anterior(es).`);
      }
      return { m, settings, sugg, sigs, segs, history };
    });

    const persistCtx = { tenantId: ctx.tenantId, userId: ctx.userId };
    const brain = new MeetingBrain(
      {
        meetingId,
        meetingType: data.m.m.meetingType as MeetingType,
        objective: data.m.m.objective,
        playbook: data.m.structure ? PlaybookStructure.parse(data.m.structure) : null,
        settings: data.settings,
        customer: data.m.customerName ? { name: data.m.customerName, segment: data.m.customerSegment } : null,
        history: data.history,
      },
      {
        ...this.providers(),
        log: (msg, d) => this.log.warn({ meetingId, ...d }, msg),
        persistence: {
          suggestion: async (s: Suggestion) => {
            await db.withContext(persistCtx, (tx) =>
              tx.insert(intelligenceSuggestions).values({
                id: s.id,
                tenantId: ctx.tenantId,
                meetingId,
                question: s.question,
                reason: s.reason,
                objective: s.objective,
                type: s.type,
                indicator: s.indicator,
                priority: s.priority,
                playbookQuestionKey: s.playbookRef?.questionKey ?? null,
                candidateKey: s.candidateKey,
                evidenceSegmentId: s.evidence?.segmentId ?? null,
                evidenceText: s.evidence?.text ?? null,
                evidenceSpeaker: s.evidence?.speaker ?? null,
                status: s.status,
                adaptedBy: s.adaptedBy,
                createdAt: s.createdAt,
              }),
            );
          },
          suggestionStatus: async (id, status) => {
            await db.withContext(persistCtx, (tx) =>
              tx
                .update(intelligenceSuggestions)
                .set({ status, resolvedAt: sql`now()` })
                .where(eq(intelligenceSuggestions.id, id)),
            );
          },
          signal: async (s: LiveSignal) => {
            await db.withContext(persistCtx, (tx) =>
              tx
                .insert(meetingLiveSignals)
                .values({
                  id: s.id,
                  tenantId: ctx.tenantId,
                  meetingId,
                  kind: s.kind,
                  key: s.key,
                  label: s.label,
                  confidence: s.confidence,
                  evidenceSegmentId: s.evidence.segmentId,
                  evidenceText: s.evidence.text,
                  evidenceSpeaker: s.evidence.speaker,
                  source: s.source,
                  createdAt: s.createdAt,
                })
                .onConflictDoNothing(),
            );
          },
          checklist: async (items) => {
            await db.withContext(persistCtx, (tx) =>
              tx.update(meetings).set({ checklist: items }).where(eq(meetings.id, meetingId)),
            );
          },
        },
      },
    );
    brain.restore({
      suggestions: data.sugg.map((r) => ({
        id: r.id,
        question: r.question,
        reason: r.reason,
        objective: r.objective,
        type: r.type as Suggestion["type"],
        indicator: r.indicator as Suggestion["indicator"],
        priority: r.priority,
        playbookRef: r.playbookQuestionKey ? { questionKey: r.playbookQuestionKey, text: r.question } : null,
        evidence: r.evidenceText
          ? { segmentId: r.evidenceSegmentId, speaker: r.evidenceSpeaker, text: r.evidenceText }
          : null,
        candidateKey: r.candidateKey,
        status: r.status,
        adaptedBy: r.adaptedBy,
        createdAt: r.createdAt,
      })),
      signals: data.sigs.map((r) => ({
        id: r.id,
        kind: r.kind,
        key: r.key,
        label: r.label,
        confidence: r.confidence,
        evidence: {
          segmentId: r.evidenceSegmentId,
          speaker: (r.evidenceSpeaker as "internal" | "customer" | null) ?? null,
          text: r.evidenceText,
        },
        source: r.source,
        createdAt: r.createdAt,
      })),
      segments: data.segs.map((s) => ({ id: s.id, speaker: s.speaker, text: s.text, startMs: s.startMs })),
      checklist: z.array(ChecklistItem).safeParse(data.m.m.checklist).data ?? [],
    });
    if (data.m.m.status === "ended" || data.m.m.status === "analyzed") brain.end();
    this.brains.set(meetingId, { brain, tenantId: ctx.tenantId, lastUsed: Date.now() });
    return brain;
  }
}
