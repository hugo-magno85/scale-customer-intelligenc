import { ExportType, ReportFilters, ReportOverview, type DashboardSummary } from "@sci/contracts";
import { RISK_SIGNALS } from "@sci/cs-skill";
import { sql, type SQL, type Tx } from "@sci/db";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { audit } from "../lib/audit.js";
import { requirePermission, tenantTx } from "../plugins/context.js";

const DEFAULT_DAYS = 90;

function range(f: ReportFilters) {
  const to = f.to ?? new Date().toISOString().slice(0, 10);
  const from = f.from ?? new Date(Date.parse(to) - DEFAULT_DAYS * 86400_000).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Conjunto de clientes do filtro (CTE `fc`) e de reuniões do período (CTE `fm`).
 * Tudo sob RLS: só dados do tenant atual entram.
 */
function scope(f: ReportFilters): SQL {
  const { from, to } = range(f);
  const customerFilter = sql.join(
    [
      sql`c.status = 'active'`,
      f.ownerUserId ? sql`c.owner_user_id = ${f.ownerUserId}` : sql`true`,
      f.segment ? sql`c.segment = ${f.segment}` : sql`true`,
      f.health ? sql`lh.classification = ${f.health}` : sql`true`,
      f.risk === "any"
        ? sql`EXISTS (SELECT 1 FROM churn_signals s WHERE s.customer_id = c.id AND s.status = 'open')`
        : sql`true`,
      f.risk === "high"
        ? sql`EXISTS (SELECT 1 FROM churn_signals s WHERE s.customer_id = c.id AND s.status = 'open' AND s.severity IN ('high','critical'))`
        : sql`true`,
      f.risk === "critical"
        ? sql`EXISTS (SELECT 1 FROM churn_signals s WHERE s.customer_id = c.id AND s.status = 'open' AND s.severity = 'critical')`
        : sql`true`,
      f.playbookId
        ? sql`EXISTS (SELECT 1 FROM meetings m JOIN playbook_versions v ON v.id = m.playbook_version_id WHERE m.customer_id = c.id AND v.playbook_id = ${f.playbookId})`
        : sql`true`,
    ],
    sql` AND `,
  );
  const customerScoped = !!(f.ownerUserId || f.segment || f.health || f.risk || f.playbookId);
  return sql`
    lh AS (
      SELECT DISTINCT ON (h.customer_id) h.customer_id, h.score, h.classification
      FROM customer_health_snapshots h WHERE h.score IS NOT NULL ORDER BY h.customer_id, h.created_at DESC
    ),
    fc AS (
      SELECT c.id, c.name, c.segment, c.owner_user_id, c.mrr_cents, lh.score, lh.classification
      FROM customers c LEFT JOIN lh ON lh.customer_id = c.id
      WHERE ${customerFilter}
    ),
    fm AS (
      SELECT m.* FROM meetings m
      LEFT JOIN playbook_versions v ON v.id = m.playbook_version_id
      WHERE coalesce(m.started_at, m.created_at) >= ${from}::date
        AND coalesce(m.started_at, m.created_at) < (${to}::date + 1)
        AND ${f.playbookId ? sql`v.playbook_id = ${f.playbookId}` : sql`true`}
        AND ${customerScoped ? sql`m.customer_id IN (SELECT id FROM fc)` : sql`true`}
    )`;
}

async function overview(tx: Tx, f: ReportFilters): Promise<ReportOverview> {
  const { from, to } = range(f);
  const s = scope(f);
  const sum = (
    await tx.execute<Record<string, string | number | null>>(sql`WITH ${s}
      SELECT
        (SELECT count(*)::int FROM fc) AS active_customers,
        (SELECT count(*)::int FROM fc WHERE score IS NOT NULL) AS with_health,
        (SELECT count(*)::int FROM fc WHERE classification = 'healthy') AS healthy,
        (SELECT count(*)::int FROM fc WHERE classification = 'attention') AS attention,
        (SELECT count(*)::int FROM fc WHERE classification = 'high_risk') AS high_risk,
        (SELECT round(avg(score)::numeric, 1)::float FROM fc WHERE score IS NOT NULL) AS average_health,
        (SELECT sum(x)::bigint FROM (SELECT DISTINCT ON (s.customer_id) s.revenue_at_risk_cents AS x FROM churn_signals s
            WHERE s.status = 'open' AND s.revenue_at_risk_cents IS NOT NULL AND s.customer_id IN (SELECT id FROM fc)
            ORDER BY s.customer_id, s.revenue_at_risk_cents DESC) r) AS revenue_at_risk,
        (SELECT count(*)::int FROM expansion_opportunities o WHERE o.status IN ('open','qualified') AND o.customer_id IN (SELECT id FROM fc)) AS open_opps,
        (SELECT count(*)::int FROM meeting_analyses a WHERE a.status = 'completed' AND a.meeting_id IN (SELECT id FROM fm)) AS analyzed,
        (SELECT count(*)::int FROM action_tasks t WHERE t.status IN ('pending','in_progress') AND (t.customer_id IS NULL OR t.customer_id IN (SELECT id FROM fc))) AS pending_tasks,
        (SELECT count(*)::int FROM action_tasks t WHERE t.status IN ('pending','in_progress') AND t.due_date < current_date AND (t.customer_id IS NULL OR t.customer_id IN (SELECT id FROM fc))) AS overdue_tasks`)
  ).rows[0]!;
  const withHealth = Number(sum.with_health);
  const summary: DashboardSummary = {
    activeCustomers: Number(sum.active_customers),
    healthy: withHealth ? Number(sum.healthy) : null,
    attention: withHealth ? Number(sum.attention) : null,
    highRisk: withHealth ? Number(sum.high_risk) : null,
    averageHealth: sum.average_health === null ? null : Number(sum.average_health),
    revenueAtRiskCents: sum.revenue_at_risk === null ? null : Number(sum.revenue_at_risk),
    openExpansionOpportunities: Number(sum.open_opps),
    analyzedMeetings: Number(sum.analyzed),
    pendingActionTasks: Number(sum.pending_tasks),
    overdueActionTasks: Number(sum.overdue_tasks),
  };

  const weekly = (
    await tx.execute<{
      week: string;
      avg_health: number | null;
      analyzed: number;
      risks: number;
      opps: number;
    }>(sql`WITH ${s},
      weeks AS (SELECT generate_series(date_trunc('week', ${from}::date), date_trunc('week', ${to}::date), interval '1 week')::date AS week)
      SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
        (SELECT round(avg(h.score)::numeric, 1)::float FROM customer_health_snapshots h
           WHERE h.score IS NOT NULL AND h.customer_id IN (SELECT id FROM fc) AND date_trunc('week', h.created_at)::date = w.week) AS avg_health,
        (SELECT count(*)::int FROM meeting_analyses a JOIN fm ON fm.id = a.meeting_id WHERE a.status = 'completed' AND date_trunc('week', a.completed_at)::date = w.week) AS analyzed,
        (SELECT count(*)::int FROM churn_signals c WHERE c.customer_id IN (SELECT id FROM fc) AND date_trunc('week', c.first_seen_at)::date = w.week) AS risks,
        (SELECT count(*)::int FROM expansion_opportunities o WHERE o.customer_id IN (SELECT id FROM fc) AND date_trunc('week', o.created_at)::date = w.week) AS opps
      FROM weeks w ORDER BY w.week`)
  ).rows.map((r) => ({
    week: r.week,
    averageHealth: r.avg_health,
    analyzedMeetings: r.analyzed,
    newRiskSignals: r.risks,
    newOpportunities: r.opps,
  }));

  const top = (
    await tx.execute<{ factor_key: string; customers: number }>(sql`WITH ${s}
      SELECT factor_key, count(DISTINCT customer_id)::int AS customers FROM churn_signals
      WHERE status = 'open' AND customer_id IN (SELECT id FROM fc) GROUP BY factor_key ORDER BY customers DESC, factor_key LIMIT 10`)
  ).rows.map((r) => ({
    factorKey: r.factor_key,
    label: RISK_SIGNALS.find((x) => x.key === r.factor_key)?.label ?? r.factor_key,
    customers: r.customers,
  }));

  const ind = (
    await tx.execute<{ indicator: string; average: number | null; samples: number }>(sql`WITH ${s}
      SELECT i.indicator, round(avg(i.score)::numeric, 1)::float AS average, count(*)::int AS samples
      FROM intelligence_indicators i JOIN fm ON fm.id = i.meeting_id WHERE i.score IS NOT NULL GROUP BY i.indicator ORDER BY i.indicator`)
  ).rows;

  const customers = (
    await tx.execute<{
      id: string;
      name: string;
      owner_name: string | null;
      segment: string | null;
      score: number | null;
      classification: "healthy" | "attention" | "high_risk" | null;
      open_risks: number;
      max_sev: string | null;
      meetings: number;
    }>(sql`WITH ${s}
      SELECT fc.id, fc.name, u.name AS owner_name, fc.segment, fc.score, fc.classification,
        (SELECT count(*)::int FROM churn_signals s WHERE s.customer_id = fc.id AND s.status = 'open') AS open_risks,
        (SELECT s.severity FROM churn_signals s WHERE s.customer_id = fc.id AND s.status = 'open'
           ORDER BY CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 1) AS max_sev,
        (SELECT count(*)::int FROM fm WHERE fm.customer_id = fc.id) AS meetings
      FROM fc LEFT JOIN users u ON u.id = fc.owner_user_id
      ORDER BY fc.score ASC NULLS LAST, fc.name LIMIT 500`)
  ).rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerName: r.owner_name,
    segment: r.segment,
    healthScore: r.score,
    healthClass: r.classification,
    openRisks: r.open_risks,
    maxSeverity: r.max_sev,
    meetings: r.meetings,
  }));

  return {
    summary,
    weekly,
    topRiskFactors: top,
    indicatorAverages: ind,
    customers,
    filtersApplied: { ...f, from, to },
  };
}

/** CSV seguro: aspas escapadas e neutralização de fórmulas (CSV injection). */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // separador ";" e BOM: abre corretamente no Excel em pt-BR
  return (
    "﻿" +
    [
      columns.map((c) => cell(c.label)).join(";"),
      ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(";")),
    ].join("\r\n")
  );
}

const EXPORTS: Record<ExportType, { columns: { key: string; label: string }[]; query: (s: SQL) => SQL }> = {
  customers: {
    columns: [
      { key: "name", label: "Cliente" },
      { key: "segment", label: "Segmento" },
      { key: "owner", label: "Responsável" },
      { key: "health", label: "Customer Health" },
      { key: "classification", label: "Classificação" },
      { key: "open_risks", label: "Riscos abertos" },
      { key: "mrr", label: "Receita mensal (R$)" },
    ],
    query: (
      s,
    ) => sql`WITH ${s} SELECT fc.name, fc.segment, u.name AS owner, replace(round(fc.score::numeric,1)::text, '.', ',') AS health,
      CASE fc.classification WHEN 'healthy' THEN 'Saudável' WHEN 'attention' THEN 'Atenção' WHEN 'high_risk' THEN 'Risco alto' END AS classification,
      (SELECT count(*) FROM churn_signals x WHERE x.customer_id = fc.id AND x.status = 'open') AS open_risks,
      replace(round(fc.mrr_cents / 100.0, 2)::text, '.', ',') AS mrr
      FROM fc LEFT JOIN users u ON u.id = fc.owner_user_id ORDER BY fc.name`,
  },
  meetings: {
    columns: [
      { key: "date", label: "Data" },
      { key: "title", label: "Reunião" },
      { key: "customer", label: "Cliente" },
      { key: "owner", label: "Responsável" },
      { key: "platform", label: "Plataforma" },
      { key: "status", label: "Status" },
      { key: "summary", label: "Resumo" },
    ],
    query: (
      s,
    ) => sql`WITH ${s} SELECT to_char(coalesce(fm.started_at, fm.created_at), 'YYYY-MM-DD HH24:MI') AS date, fm.title, c.name AS customer, u.name AS owner, fm.platform, fm.status,
      (SELECT a.summary FROM meeting_analyses a WHERE a.meeting_id = fm.id AND a.status = 'completed' ORDER BY a.version DESC LIMIT 1) AS summary
      FROM fm LEFT JOIN customers c ON c.id = fm.customer_id LEFT JOIN users u ON u.id = fm.owner_user_id ORDER BY 1 DESC`,
  },
  churn: {
    columns: [
      { key: "customer", label: "Cliente" },
      { key: "factor", label: "Fator" },
      { key: "severity", label: "Severidade" },
      { key: "recurrence", label: "Recorrência" },
      { key: "status", label: "Status" },
      { key: "evidence", label: "Evidência" },
      { key: "recommendation", label: "Recomendação" },
      { key: "revenue", label: "Receita em risco (R$)" },
    ],
    query: (s) => sql`WITH ${s} SELECT fc.name AS customer, x.factor_label AS factor,
      CASE x.severity WHEN 'critical' THEN 'Crítico' WHEN 'high' THEN 'Alto' WHEN 'medium' THEN 'Médio' ELSE 'Baixo' END AS severity, x.recurrence,
      CASE x.status WHEN 'open' THEN 'Aberto' WHEN 'monitoring' THEN 'Em acompanhamento' ELSE 'Resolvido' END AS status, x.evidence->0->>'text' AS evidence, x.recommendation,
      replace(round(x.revenue_at_risk_cents / 100.0, 2)::text, '.', ',') AS revenue
      FROM churn_signals x JOIN fc ON fc.id = x.customer_id ORDER BY fc.name`,
  },
  opportunities: {
    columns: [
      { key: "customer", label: "Cliente" },
      { key: "type", label: "Tipo" },
      { key: "need", label: "Necessidade" },
      { key: "status", label: "Status" },
      { key: "potential", label: "Potencial (R$)" },
      { key: "evidence", label: "Evidência" },
    ],
    query: (s) => sql`WITH ${s} SELECT fc.name AS customer, o.type_label AS type, o.need, o.status,
      replace(round(o.potential_cents / 100.0, 2)::text, '.', ',') AS potential, o.evidence->0->>'text' AS evidence
      FROM expansion_opportunities o JOIN fc ON fc.id = o.customer_id ORDER BY fc.name`,
  },
  tasks: {
    columns: [
      { key: "title", label: "Tarefa" },
      { key: "customer", label: "Cliente" },
      { key: "owner", label: "Responsável" },
      { key: "due", label: "Prazo" },
      { key: "priority", label: "Prioridade" },
      { key: "status", label: "Status" },
    ],
    query: (
      s,
    ) => sql`WITH ${s} SELECT t.title, c.name AS customer, u.name AS owner, t.due_date AS due, t.priority,
      CASE WHEN t.status IN ('pending','in_progress') AND t.due_date < current_date THEN 'Atrasado'
           WHEN t.status = 'pending' THEN 'Pendente' WHEN t.status = 'in_progress' THEN 'Em andamento'
           WHEN t.status = 'done' THEN 'Concluído' ELSE 'Cancelado' END AS status
      FROM action_tasks t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.owner_user_id
      WHERE t.customer_id IS NULL OR t.customer_id IN (SELECT id FROM fc) ORDER BY t.due_date NULLS LAST`,
  },
  indicators: {
    columns: [
      { key: "date", label: "Data" },
      { key: "customer", label: "Cliente" },
      { key: "indicator", label: "Indicador" },
      { key: "score", label: "Nota" },
      { key: "confidence", label: "Confiança" },
      { key: "evidence", label: "Evidência" },
    ],
    query: (
      s,
    ) => sql`WITH ${s} SELECT to_char(i.created_at, 'YYYY-MM-DD') AS date, c.name AS customer, i.indicator, replace(round(i.score::numeric, 1)::text, '.', ',') AS score, replace(round(i.confidence::numeric, 2)::text, '.', ',') AS confidence, i.evidence->0->>'text' AS evidence
      FROM intelligence_indicators i JOIN fm ON fm.id = i.meeting_id LEFT JOIN customers c ON c.id = i.customer_id WHERE i.score IS NOT NULL ORDER BY 1, 2`,
  },
};

export async function reportRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/reports/overview",
    {
      schema: { tags: ["reports"], querystring: ReportFilters, response: { 200: ReportOverview } },
      preHandler: requirePermission("reports.read"),
    },
    async (req) => tenantTx(req, (tx) => overview(tx, req.query)),
  );

  app.get(
    "/reports/export",
    {
      schema: { tags: ["reports"], querystring: ReportFilters.extend({ type: ExportType }) },
      preHandler: requirePermission("reports.read"),
    },
    async (req, reply) => {
      const { type, ...filters } = req.query;
      const def = EXPORTS[type];
      const rows = await tenantTx(req, async (tx) => {
        const r = await tx.execute<Record<string, unknown>>(def.query(scope(filters)));
        await audit(tx, req, {
          action: "report.exported",
          entityType: "report",
          entityId: type,
          metadata: { filters, rows: r.rows.length },
        });
        return r.rows;
      });
      const name = `scale-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${name}"`)
        .header("cache-control", "no-store")
        .send(toCsv(rows, def.columns));
    },
  );
}
