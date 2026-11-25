import {
  ActionTask,
  ChurnSignal,
  CreateTaskRequest,
  CustomerHealthRow,
  DashboardSummary,
  ExpansionOpportunity,
  HealthSettings,
  HealthSnapshot,
  MeetingAnalysis,
  UpdateOpportunityRequest,
  UpdateTaskRequest,
  type IndicatorResult,
  type QuoteEvidence,
} from "@sci/contracts";
import {
  actionTasks,
  and,
  asc,
  churnSignals,
  count,
  customerHealthSnapshots,
  customers,
  desc,
  eq,
  expansionOpportunities,
  intelligenceIndicators,
  meetingAnalyses,
  meetings,
  meetingTranscriptSegments,
  sql,
  tenantHealthSettings,
  users,
  type Tx,
} from "@sci/db";
import { loadHealthSettings } from "@sci/jobs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound, pgCode } from "../lib/errors.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

const Id = z.object({ id: z.uuid() });
const today = () => new Date().toISOString().slice(0, 10);

/** Cria uma nova versão de análise e enfileira. Usado ao encerrar a reunião e sob demanda. */
export async function requestAnalysis(
  req: FastifyRequest,
  meetingId: string,
  opts: { onlyIfTranscript?: boolean } = {},
) {
  const created = await tenantTx(req, async (tx) => {
    const [m] = await tx.select().from(meetings).where(eq(meetings.id, meetingId));
    if (!m) throw notFound("Reunião");
    if (m.status !== "ended" && m.status !== "analyzed")
      throw conflict("Encerre a reunião antes de analisá-la");
    if (opts.onlyIfTranscript) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(meetingTranscriptSegments)
        .where(eq(meetingTranscriptSegments.meetingId, meetingId));
      if (!n) return null;
    }
    const busy = await tx
      .select({ id: meetingAnalyses.id })
      .from(meetingAnalyses)
      .where(and(eq(meetingAnalyses.meetingId, meetingId), eq(meetingAnalyses.status, "processing")));
    if (busy.length) throw conflict("Já existe uma análise em andamento para esta reunião");
    await tx.execute(sql`SELECT 1 FROM meetings WHERE id = ${meetingId} FOR UPDATE`);
    const [{ v } = { v: 0 }] = await tx
      .select({ v: sql<number>`coalesce(max(${meetingAnalyses.version}), 0)` })
      .from(meetingAnalyses)
      .where(eq(meetingAnalyses.meetingId, meetingId));
    const [a] = await tx
      .insert(meetingAnalyses)
      .values({
        tenantId: req.tenant!.tenantId,
        meetingId,
        version: Number(v) + 1,
        status: "processing",
        skillVersion: m.skillVersion,
        playbookVersionId: m.playbookVersionId,
        requestedBy: req.auth!.userId,
      })
      .returning({ id: meetingAnalyses.id });
    await audit(tx, req, {
      action: "meeting.analysis.requested",
      entityType: "meeting",
      entityId: meetingId,
      metadata: { analysisId: a!.id },
    });
    return a!.id;
  });
  if (created)
    await req.server.jobs.analyzeMeeting({
      tenantId: req.tenant!.tenantId,
      analysisId: created,
      requestedBy: req.auth!.userId,
    });
  return created;
}

async function getAnalysis(tx: Tx, meetingId: string): Promise<MeetingAnalysis | null> {
  const [a] = await tx
    .select()
    .from(meetingAnalyses)
    .where(eq(meetingAnalyses.meetingId, meetingId))
    .orderBy(desc(meetingAnalyses.version))
    .limit(1);
  if (!a) return null;
  const inds = await tx
    .select()
    .from(intelligenceIndicators)
    .where(eq(intelligenceIndicators.analysisId, a.id));
  const r = a.result as Partial<MeetingAnalysis>;
  const toClass = (s: number | null) =>
    s === null
      ? null
      : s < 20
        ? "very_low"
        : s < 40
          ? "low"
          : s < 60
            ? "moderate"
            : s < 80
              ? "high"
              : "very_high";
  return {
    id: a.id,
    meetingId: a.meetingId,
    version: a.version,
    status: a.status,
    mode: a.mode,
    summary: a.summary,
    diagnosis: a.diagnosis,
    objectives: r.objectives ?? [],
    questionsAsked: r.questionsAsked ?? [],
    unansweredQuestions: r.unansweredQuestions ?? [],
    needs: r.needs ?? [],
    feedbacks: r.feedbacks ?? [],
    recommendations: r.recommendations ?? [],
    risks: r.risks ?? [],
    opportunities: r.opportunities ?? [],
    indicators: inds.map((i) => ({
      indicator: i.indicator as IndicatorResult["indicator"],
      score: i.score,
      classification: toClass(i.score) as IndicatorResult["classification"],
      confidence: i.confidence,
      rationale: i.rationale,
      evidence: i.evidence as QuoteEvidence[],
    })),
    error: a.error,
    warnings: a.warnings,
    model: a.model,
    skillVersion: a.skillVersion,
    playbookVersionId: a.playbookVersionId,
    createdAt: a.createdAt,
    completedAt: a.completedAt,
  };
}

function taskStatus(t: { status: string; dueDate: string | null }): ActionTask["status"] {
  if ((t.status === "pending" || t.status === "in_progress") && t.dueDate && t.dueDate < today())
    return "overdue";
  return t.status as ActionTask["status"];
}

const owner = sql<string | null>`(SELECT name FROM users u WHERE u.id = owner_user_id)`;

async function listTasks(tx: Tx, where: ReturnType<typeof and> | undefined): Promise<ActionTask[]> {
  const rows = await tx
    .select({ t: actionTasks, customerName: customers.name, ownerName: users.name })
    .from(actionTasks)
    .leftJoin(customers, eq(customers.id, actionTasks.customerId))
    .leftJoin(users, eq(users.id, actionTasks.ownerUserId))
    .where(where)
    .orderBy(sql`${actionTasks.dueDate} NULLS LAST`, desc(actionTasks.createdAt))
    .limit(500);
  return rows.map(({ t, customerName, ownerName }) => ({
    id: t.id,
    planId: t.planId,
    customerId: t.customerId,
    customerName,
    meetingId: t.meetingId,
    title: t.title,
    description: t.description,
    ownerUserId: t.ownerUserId,
    ownerName,
    responsibleParty: t.responsibleParty,
    dueDate: t.dueDate,
    priority: t.priority,
    status: taskStatus(t),
    evidence: t.evidence as QuoteEvidence[],
    recommendation: t.recommendation,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  }));
}

function fk(err: unknown): never {
  if (pgCode(err) === "23503") throw badRequest("Responsável ou cliente inválido para este tenant");
  throw err;
}

export async function customerIntelligenceRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();
  void owner;

  // Análise --------------------------------------------------------------------
  app.post(
    "/meetings/:id/analyze",
    {
      schema: { tags: ["analysis"], params: Id, response: { 202: z.object({ analysisId: z.uuid() }) } },
      preHandler: requirePermission("meetings.capture"),
    },
    async (req, reply) =>
      reply.status(202).send({ analysisId: (await requestAnalysis(req, req.params.id))! }),
  );

  app.get(
    "/meetings/:id/analysis",
    {
      schema: { tags: ["analysis"], params: Id, response: { 200: MeetingAnalysis.nullable() } },
      preHandler: requirePermission("analyses.read"),
    },
    async (req) => tenantTx(req, (tx) => getAnalysis(tx, req.params.id)),
  );

  // Customer Health ---------------------------------------------------------------
  app.get(
    "/health/customers",
    {
      schema: { tags: ["health"], response: { 200: z.array(CustomerHealthRow) } },
      preHandler: requirePermission("analyses.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const r = await tx.execute<{
          customer_id: string;
          name: string;
          segment: string | null;
          owner_name: string | null;
          mrr_cents: string | null;
          score: number | null;
          classification: "healthy" | "attention" | "high_risk" | null;
          prev_score: number | null;
          last_meeting_at: string | null;
          open_risks: number;
        }>(sql`
          SELECT c.id AS customer_id, c.name, c.segment, u.name AS owner_name, c.mrr_cents,
                 h.score, h.classification, hp.score AS prev_score,
                 (SELECT max(coalesce(m.started_at, m.created_at)) FROM meetings m WHERE m.customer_id = c.id) AS last_meeting_at,
                 (SELECT count(*)::int FROM churn_signals s WHERE s.customer_id = c.id AND s.status = 'open') AS open_risks
          FROM customers c
          LEFT JOIN users u ON u.id = c.owner_user_id
          LEFT JOIN LATERAL (SELECT score, classification FROM customer_health_snapshots x WHERE x.customer_id = c.id AND x.score IS NOT NULL ORDER BY created_at DESC LIMIT 1) h ON true
          LEFT JOIN LATERAL (SELECT score FROM customer_health_snapshots x WHERE x.customer_id = c.id AND x.score IS NOT NULL ORDER BY created_at DESC OFFSET 1 LIMIT 1) hp ON true
          WHERE c.status = 'active'
          ORDER BY h.score ASC NULLS LAST, c.name`);
        return r.rows.map((x) => ({
          customerId: x.customer_id,
          customerName: x.name,
          ownerName: x.owner_name,
          segment: x.segment,
          score: x.score,
          classification: x.classification,
          trend:
            x.score !== null && x.prev_score !== null ? Math.round((x.score - x.prev_score) * 10) / 10 : null,
          lastMeetingAt: x.last_meeting_at ? new Date(x.last_meeting_at).toISOString() : null,
          openRisks: x.open_risks,
          mrrCents: x.mrr_cents === null ? null : Number(x.mrr_cents),
        }));
      }),
  );

  app.get(
    "/customers/:id/health",
    {
      schema: {
        tags: ["health"],
        params: Id,
        response: {
          200: z.object({
            current: HealthSnapshot.nullable(),
            history: z.array(HealthSnapshot),
            indicators: z.array(
              z.object({
                indicator: z.string(),
                points: z.array(z.object({ meetingId: z.uuid(), date: z.string(), score: z.number() })),
              }),
            ),
          }),
        },
      },
      preHandler: requirePermission("analyses.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const [c] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, req.params.id));
        if (!c) throw notFound("Cliente");
        const snaps = await tx
          .select()
          .from(customerHealthSnapshots)
          .where(eq(customerHealthSnapshots.customerId, c.id))
          .orderBy(asc(customerHealthSnapshots.createdAt));
        const history = snaps.map((s) => ({
          id: s.id,
          customerId: s.customerId,
          meetingId: s.meetingId,
          score: s.score,
          classification: s.classification,
          factors: s.factors as HealthSnapshot["factors"],
          missing: s.missing as HealthSnapshot["missing"],
          overrides: s.overrides,
          createdAt: s.createdAt,
        }));
        const inds = await tx
          .select({
            indicator: intelligenceIndicators.indicator,
            score: intelligenceIndicators.score,
            meetingId: intelligenceIndicators.meetingId,
            createdAt: intelligenceIndicators.createdAt,
          })
          .from(intelligenceIndicators)
          .where(
            and(
              eq(intelligenceIndicators.customerId, c.id),
              sql`${intelligenceIndicators.score} IS NOT NULL`,
            ),
          )
          .orderBy(asc(intelligenceIndicators.createdAt));
        const by = new Map<string, { meetingId: string; date: string; score: number }[]>();
        for (const i of inds)
          by.set(i.indicator, [
            ...(by.get(i.indicator) ?? []),
            { meetingId: i.meetingId, date: i.createdAt, score: i.score! },
          ]);
        return {
          current: [...history].reverse().find((h) => h.score !== null) ?? history.at(-1) ?? null,
          history,
          indicators: [...by].map(([indicator, points]) => ({ indicator, points })),
        };
      }),
  );

  app.get(
    "/settings/health",
    {
      schema: { tags: ["health"], response: { 200: HealthSettings } },
      preHandler: requirePermission("analyses.read"),
    },
    async (req) => tenantTx(req, loadHealthSettings),
  );
  app.put(
    "/settings/health",
    {
      schema: { tags: ["health"], body: HealthSettings, response: { 200: HealthSettings } },
      preHandler: requirePermission("tenant.settings.manage"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const before = await loadHealthSettings(tx);
        await tx
          .insert(tenantHealthSettings)
          .values({ tenantId: req.tenant!.tenantId, settings: req.body, updatedBy: req.auth!.userId })
          .onConflictDoUpdate({
            target: tenantHealthSettings.tenantId,
            set: { settings: req.body, updatedBy: req.auth!.userId, updatedAt: new Date().toISOString() },
          });
        await audit(tx, req, {
          action: "health.settings.updated",
          entityType: "tenant",
          entityId: req.tenant!.tenantId,
          metadata: { before, after: req.body },
        });
        return req.body;
      }),
  );

  // Churn Radar ---------------------------------------------------------------------
  app.get(
    "/churn-signals",
    {
      schema: {
        tags: ["churn"],
        querystring: z.object({
          status: z.enum(["open", "monitoring", "resolved"]).optional(),
          customerId: z.uuid().optional(),
          severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        }),
        response: { 200: z.array(ChurnSignal) },
      },
      preHandler: requirePermission("analyses.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const rows = await tx
          .select({ s: churnSignals, customerName: customers.name, ownerName: users.name })
          .from(churnSignals)
          .innerJoin(customers, eq(customers.id, churnSignals.customerId))
          .leftJoin(users, eq(users.id, customers.ownerUserId))
          .where(
            and(
              req.query.status ? eq(churnSignals.status, req.query.status) : undefined,
              req.query.customerId ? eq(churnSignals.customerId, req.query.customerId) : undefined,
              req.query.severity ? eq(churnSignals.severity, req.query.severity) : undefined,
            ),
          )
          .orderBy(
            sql`CASE ${churnSignals.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
            desc(churnSignals.lastSeenAt),
          );
        return rows.map(({ s, customerName, ownerName }) => ({
          id: s.id,
          customerId: s.customerId,
          customerName,
          ownerName,
          factorKey: s.factorKey,
          factorLabel: s.factorLabel,
          severity: s.severity,
          recurrence: s.recurrence,
          status: s.status,
          evidence: s.evidence as QuoteEvidence[],
          recommendation: s.recommendation,
          nextAction: s.nextAction,
          revenueAtRiskCents: s.revenueAtRiskCents,
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
          lastMeetingId: s.lastMeetingId,
        }));
      }),
  );
  app.patch(
    "/churn-signals/:id",
    {
      schema: {
        tags: ["churn"],
        params: Id,
        body: z.object({
          status: z.enum(["open", "monitoring", "resolved"]).optional(),
          nextAction: z.string().trim().max(500).nullable().optional(),
        }),
      },
      preHandler: requirePermission("action_plans.manage"),
    },
    async (req, reply) => {
      await tenantTx(req, async (tx) => {
        const r = await tx
          .update(churnSignals)
          .set({
            ...(req.body.status ? { status: req.body.status } : {}),
            ...(req.body.nextAction !== undefined ? { nextAction: req.body.nextAction } : {}),
          })
          .where(eq(churnSignals.id, req.params.id))
          .returning({ id: churnSignals.id });
        if (!r.length) throw notFound("Sinal");
        await audit(tx, req, {
          action: "churn_signal.updated",
          entityType: "churn_signal",
          entityId: req.params.id,
          metadata: req.body,
        });
      });
      return reply.status(204).send();
    },
  );

  // Expansão ---------------------------------------------------------------------------
  const listOpps = (tx: Tx, where?: ReturnType<typeof and>) =>
    tx
      .select({ o: expansionOpportunities, customerName: customers.name, ownerName: users.name })
      .from(expansionOpportunities)
      .innerJoin(customers, eq(customers.id, expansionOpportunities.customerId))
      .leftJoin(users, eq(users.id, expansionOpportunities.ownerUserId))
      .where(where)
      .orderBy(desc(expansionOpportunities.createdAt))
      .then((rows) =>
        rows.map(({ o, customerName, ownerName }) => ({
          id: o.id,
          customerId: o.customerId,
          customerName,
          meetingId: o.meetingId,
          type: o.type,
          typeLabel: o.typeLabel,
          need: o.need,
          evidence: o.evidence as QuoteEvidence[],
          potentialCents: o.potentialCents,
          product: o.product,
          nextAction: o.nextAction,
          ownerUserId: o.ownerUserId,
          ownerName,
          status: o.status,
          createdAt: o.createdAt,
        })),
      );
  app.get(
    "/opportunities",
    {
      schema: {
        tags: ["expansion"],
        querystring: z.object({
          status: z.enum(["open", "qualified", "won", "lost", "discarded"]).optional(),
          customerId: z.uuid().optional(),
        }),
        response: { 200: z.array(ExpansionOpportunity) },
      },
      preHandler: requirePermission("analyses.read"),
    },
    async (req) =>
      tenantTx(req, (tx) =>
        listOpps(
          tx,
          and(
            req.query.status ? eq(expansionOpportunities.status, req.query.status) : undefined,
            req.query.customerId ? eq(expansionOpportunities.customerId, req.query.customerId) : undefined,
          ),
        ),
      ),
  );
  app.patch(
    "/opportunities/:id",
    {
      schema: {
        tags: ["expansion"],
        params: Id,
        body: UpdateOpportunityRequest,
        response: { 200: ExpansionOpportunity },
      },
      preHandler: requirePermission("action_plans.manage"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const r = await tx
          .update(expansionOpportunities)
          .set(req.body)
          .where(eq(expansionOpportunities.id, req.params.id))
          .returning({ id: expansionOpportunities.id });
        if (!r.length) throw notFound("Oportunidade");
        await audit(tx, req, {
          action: "opportunity.updated",
          entityType: "opportunity",
          entityId: req.params.id,
          metadata: req.body,
        });
        return (await listOpps(tx, eq(expansionOpportunities.id, req.params.id)))[0]!;
      }).catch(fk),
  );

  // Planos de ação -----------------------------------------------------------------
  app.get(
    "/tasks",
    {
      schema: {
        tags: ["action-plans"],
        querystring: z.object({
          status: z.enum(["pending", "in_progress", "done", "overdue", "cancelled"]).optional(),
          ownerUserId: z.uuid().optional(),
          customerId: z.uuid().optional(),
          meetingId: z.uuid().optional(),
        }),
        response: { 200: z.array(ActionTask) },
      },
      preHandler: requirePermission("action_plans.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const q = req.query;
        const overdue = q.status === "overdue";
        const list = await listTasks(
          tx,
          and(
            q.status && q.status !== "overdue" ? eq(actionTasks.status, q.status) : undefined,
            overdue
              ? sql`${actionTasks.status} IN ('pending','in_progress') AND ${actionTasks.dueDate} < current_date`
              : undefined,
            q.ownerUserId ? eq(actionTasks.ownerUserId, q.ownerUserId) : undefined,
            q.customerId ? eq(actionTasks.customerId, q.customerId) : undefined,
            q.meetingId ? eq(actionTasks.meetingId, q.meetingId) : undefined,
          ),
        );
        return q.status === "pending" || q.status === "in_progress"
          ? list.filter((t) => t.status !== "overdue")
          : list;
      }),
  );
  app.post(
    "/tasks",
    {
      schema: { tags: ["action-plans"], body: CreateTaskRequest, response: { 201: ActionTask } },
      preHandler: requirePermission("action_plans.manage"),
    },
    async (req, reply) => {
      const t = await tenantTx(req, async (tx) => {
        const b = req.body;
        const [row] = await tx
          .insert(actionTasks)
          .values({
            tenantId: req.tenant!.tenantId,
            title: b.title,
            description: b.description ?? null,
            customerId: b.customerId ?? null,
            meetingId: b.meetingId ?? null,
            ownerUserId: b.ownerUserId ?? req.auth!.userId,
            dueDate: b.dueDate ?? null,
            priority: b.priority,
            createdBy: req.auth!.userId,
          })
          .returning({ id: actionTasks.id });
        await audit(tx, req, { action: "task.created", entityType: "task", entityId: row!.id });
        return (await listTasks(tx, eq(actionTasks.id, row!.id)))[0]!;
      }).catch(fk);
      return reply.status(201).send(t);
    },
  );
  app.patch(
    "/tasks/:id",
    {
      schema: { tags: ["action-plans"], params: Id, body: UpdateTaskRequest, response: { 200: ActionTask } },
      preHandler: requirePermission("action_plans.manage"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const b = req.body;
        const patch: Partial<typeof actionTasks.$inferInsert> = { ...b };
        if (b.status === "done") patch.completedAt = new Date().toISOString();
        else if (b.status) patch.completedAt = null;
        const r = await tx
          .update(actionTasks)
          .set(patch)
          .where(eq(actionTasks.id, req.params.id))
          .returning({ id: actionTasks.id });
        if (!r.length) throw notFound("Tarefa");
        await audit(tx, req, {
          action: "task.updated",
          entityType: "task",
          entityId: req.params.id,
          metadata: b,
        });
        return (await listTasks(tx, eq(actionTasks.id, req.params.id)))[0]!;
      }).catch(fk),
  );

  // Dashboard com números reais -------------------------------------------------------
  app.get(
    "/dashboard/summary",
    {
      schema: { tags: ["dashboard"], response: { 200: DashboardSummary } },
      preHandler: requirePermission("reports.read"),
    },
    async (req) =>
      tenantTx(req, async (tx) => {
        const r = await tx.execute<Record<string, number | string | null>>(sql`
          WITH latest AS (
            SELECT DISTINCT ON (h.customer_id) h.customer_id, h.score, h.classification
            FROM customer_health_snapshots h JOIN customers c ON c.id = h.customer_id AND c.status = 'active'
            WHERE h.score IS NOT NULL ORDER BY h.customer_id, h.created_at DESC)
          SELECT
            (SELECT count(*)::int FROM customers WHERE status = 'active') AS active_customers,
            (SELECT count(*)::int FROM latest) AS with_health,
            (SELECT count(*)::int FROM latest WHERE classification = 'healthy') AS healthy,
            (SELECT count(*)::int FROM latest WHERE classification = 'attention') AS attention,
            (SELECT count(*)::int FROM latest WHERE classification = 'high_risk') AS high_risk,
            (SELECT round(avg(score)::numeric, 1)::float FROM latest) AS average_health,
            (SELECT sum(rar)::bigint FROM (SELECT DISTINCT ON (customer_id) customer_id, revenue_at_risk_cents AS rar FROM churn_signals WHERE status = 'open' AND revenue_at_risk_cents IS NOT NULL ORDER BY customer_id, revenue_at_risk_cents DESC) x) AS revenue_at_risk,
            (SELECT count(*)::int FROM expansion_opportunities WHERE status IN ('open','qualified')) AS open_opps,
            (SELECT count(*)::int FROM meeting_analyses WHERE status = 'completed') AS analyzed,
            (SELECT count(*)::int FROM action_tasks WHERE status IN ('pending','in_progress')) AS pending_tasks,
            (SELECT count(*)::int FROM action_tasks WHERE status IN ('pending','in_progress') AND due_date < current_date) AS overdue_tasks`);
        const x = r.rows[0]!;
        const withHealth = Number(x.with_health);
        return {
          activeCustomers: Number(x.active_customers),
          healthy: withHealth ? Number(x.healthy) : null,
          attention: withHealth ? Number(x.attention) : null,
          highRisk: withHealth ? Number(x.high_risk) : null,
          averageHealth: x.average_health === null ? null : Number(x.average_health),
          revenueAtRiskCents: x.revenue_at_risk === null ? null : Number(x.revenue_at_risk),
          openExpansionOpportunities: Number(x.open_opps),
          analyzedMeetings: Number(x.analyzed),
          pendingActionTasks: Number(x.pending_tasks),
          overdueActionTasks: Number(x.overdue_tasks),
        };
      }),
  );
}
