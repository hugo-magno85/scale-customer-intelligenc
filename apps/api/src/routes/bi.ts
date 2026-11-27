import {
  BiFilters,
  healthBands,
  ReportBi,
  type BiComparison,
  type BiKpi,
  type HealthClass,
} from "@sci/contracts";
import { RISK_SIGNALS } from "@sci/cs-skill";
import { sql, type SQL, type Tx } from "@sci/db";
import { loadHealthSettings } from "@sci/jobs";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requirePermission, tenantTx } from "../plugins/context.js";
import { customerScope, isCustomerScoped } from "./reports.js";

/* ---------------------------------------------------------------- datas -- */

const DAY = 86400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => iso(parse(d) + n * DAY);
export function addYears(d: string, n: number) {
  const x = new Date(parse(d));
  x.setUTCFullYear(x.getUTCFullYear() + n);
  return iso(x.getTime());
}
const days = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY) + 1;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export interface Bucket {
  label: string;
  start: string;
  end: string;
}

/** Semanas (períodos de até 120 dias) ou meses do calendário, sempre recortados ao período. */
export function makeBuckets(from: string, to: string): { granularity: "week" | "month"; buckets: Bucket[] } {
  const out: Bucket[] = [];
  if (days(from, to) <= 120) {
    for (let s = from; s <= to; s = addDays(s, 7)) {
      const e = addDays(s, 6) < to ? addDays(s, 6) : to;
      out.push({ label: `${s.slice(8, 10)}/${s.slice(5, 7)}`, start: s, end: e });
    }
    return { granularity: "week", buckets: out };
  }
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7)) - 1;
  for (;;) {
    const ms = iso(Date.UTC(y, m, 1));
    if (ms > to) break;
    const me = iso(Date.UTC(y, m + 1, 0));
    out.push({
      label: `${MONTHS[m]}/${String(y).slice(2)}`,
      start: ms < from ? from : ms,
      end: me > to ? to : me,
    });
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return { granularity: "month", buckets: out };
}

/** Período de comparação de mesmo tamanho: imediatamente anterior ou o mesmo intervalo um ano antes. */
export function comparisonRange(from: string, to: string, mode: "previous" | "year") {
  if (mode === "year") return { from: addYears(from, -1), to: addYears(to, -1) };
  const len = days(from, to);
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
const shift = (d: string, from: string, cmpFrom: string, mode: "previous" | "year") =>
  mode === "year" ? addYears(d, -1) : addDays(d, -(parse(from) - parse(cmpFrom)) / DAY);

const pct = (cur: number | null, prev: number | null) =>
  cur === null || prev === null || prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10;

function cmp(
  cur: number | null,
  prev: number | null,
  hasHistory: boolean,
  note: string | null = null,
): BiComparison {
  if (!hasHistory || prev === null)
    return {
      previous: null,
      delta: null,
      deltaPct: null,
      status: "no_history",
      note: note ?? "Sem histórico no período de comparação",
    };
  return {
    previous: prev,
    delta: cur === null ? null : Math.round((cur - prev) * 10) / 10,
    deltaPct: pct(cur, prev),
    status: "ok",
    note,
  };
}
const na = (note: string): BiComparison => ({
  previous: null,
  delta: null,
  deltaPct: null,
  status: "not_applicable",
  note,
});

const inBucket = (d: string, b: Bucket) => d >= b.start && d <= b.end;
const list = (ds: string[]) =>
  sql`(SELECT x::date AS d FROM unnest(string_to_array(${ds.join(",")}, ',')) x)`;

/* -------------------------------------------------------------- consulta -- */

async function bi(tx: Tx, f: BiFilters): Promise<ReportBi> {
  const to = f.to ?? iso(Date.now());
  const from = f.from ?? addDays(to, -89);
  const mode = f.compare ?? "previous";
  const c = comparisonRange(from, to, mode);
  const { granularity, buckets } = makeBuckets(from, to);
  const cbuckets = buckets.map((b) => ({
    ...b,
    start: shift(b.start, from, c.from, mode),
    end: shift(b.end, from, c.from, mode),
  }));
  const cs = customerScope(f);
  const scoped = isCustomerScoped(f);
  /** Reunião no escopo do filtro (playbook/cliente), alias m. */
  const meetingIn: SQL = sql`(${
    f.playbookId
      ? sql`EXISTS (SELECT 1 FROM playbook_versions v WHERE v.id = m.playbook_version_id AND v.playbook_id = ${f.playbookId})`
      : sql`true`
  } AND ${scoped ? sql`m.customer_id IN (SELECT id FROM fc)` : sql`true`})`;
  const taskIn: SQL = sql`(t.customer_id IS NULL OR t.customer_id IN (SELECT id FROM fc))`;
  const inRanges = (col: SQL) =>
    sql`((${col})::date BETWEEN ${from}::date AND ${to}::date OR (${col})::date BETWEEN ${c.from}::date AND ${c.to}::date)`;

  const settings = await loadHealthSettings(tx);
  const bands = healthBands(settings);
  const classify = (s: number | null): HealthClass | null =>
    s === null
      ? null
      : s >= bands.healthyMin
        ? "healthy"
        : s >= bands.attentionMin
          ? "attention"
          : "high_risk";

  // Início do uso (primeira reunião registrada): antes disso não há histórico para comparar.
  const first = (
    await tx.execute<{ d: string | null }>(
      sql`SELECT to_char(min(created_at), 'YYYY-MM-DD') AS d FROM meetings`,
    )
  ).rows[0]?.d;
  const flowHistory = !!first && first <= c.to;

  /* Customer Health como estava ao fim de cada data (último snapshot até a data). */
  const prevMonthEnd = addDays(`${to.slice(0, 7)}-01`, -1);
  const asOfDates = [
    ...new Set([
      to,
      c.to,
      prevMonthEnd,
      addYears(to, -1),
      ...buckets.map((b) => b.end),
      ...cbuckets.map((b) => b.end),
    ]),
  ];
  const asOfRows = (
    await tx.execute<{
      d: string;
      avg: number | null;
      n: number;
      healthy: number;
      attention: number;
      high: number;
    }>(sql`WITH ${cs}
      SELECT to_char(d.d, 'YYYY-MM-DD') AS d, round(avg(h.score)::numeric, 1)::float AS avg,
        count(h.customer_id)::int AS n,
        count(*) FILTER (WHERE h.classification = 'healthy')::int AS healthy,
        count(*) FILTER (WHERE h.classification = 'attention')::int AS attention,
        count(*) FILTER (WHERE h.classification = 'high_risk')::int AS high
      FROM ${list(asOfDates)} d
      LEFT JOIN LATERAL (
        SELECT DISTINCT ON (s.customer_id) s.customer_id, s.score, s.classification
        FROM customer_health_snapshots s
        WHERE s.score IS NOT NULL AND s.created_at < d.d + 1 AND s.customer_id IN (SELECT id FROM fc)
        ORDER BY s.customer_id, s.created_at DESC
      ) h ON true
      GROUP BY d.d`)
  ).rows;
  const asOf = new Map(asOfRows.map((r) => [r.d, r]));
  const at = (d: string) => asOf.get(d)!;
  const avgAt = (d: string) => (at(d).n ? at(d).avg : null);
  const countAt = (d: string, k: "healthy" | "attention" | "high") => (at(d).n ? at(d)[k] : null);

  /* Ações (tarefas) pendentes/atrasadas como estavam em cada data. */
  const taskDates = [...new Set([to, c.to, ...buckets.map((b) => b.end)])];
  const taskRows = (
    await tx.execute<{ d: string; existed: number; pending: number; overdue: number }>(sql`WITH ${cs}
      SELECT to_char(d.d, 'YYYY-MM-DD') AS d, count(t.id)::int AS existed,
        count(t.id) FILTER (WHERE (t.completed_at IS NULL OR t.completed_at >= d.d + 1)
          AND NOT (t.status = 'cancelled' AND t.updated_at < d.d + 1)
          AND NOT (t.status = 'done' AND t.completed_at IS NULL))::int AS pending,
        count(t.id) FILTER (WHERE (t.completed_at IS NULL OR t.completed_at >= d.d + 1)
          AND NOT (t.status = 'cancelled' AND t.updated_at < d.d + 1)
          AND NOT (t.status = 'done' AND t.completed_at IS NULL) AND t.due_date < d.d)::int AS overdue
      FROM ${list(taskDates)} d
      LEFT JOIN action_tasks t ON t.created_at < d.d + 1 AND ${taskIn}
      GROUP BY d.d`)
  ).rows;
  const tasksAt = new Map(taskRows.map((r) => [r.d, r]));

  /* Séries diárias (período + comparação), agregadas em semanas/meses aqui. */
  const meetingsDaily = (
    await tx.execute<{ d: string; n: number }>(sql`WITH ${cs}
      SELECT to_char(coalesce(m.started_at, m.created_at), 'YYYY-MM-DD') AS d, count(DISTINCT m.id)::int AS n
      FROM meetings m WHERE ${meetingIn} AND ${inRanges(sql`coalesce(m.started_at, m.created_at)`)}
        AND EXISTS (SELECT 1 FROM meeting_analyses a WHERE a.meeting_id = m.id AND a.status = 'completed')
      GROUP BY 1`)
  ).rows;
  const indDaily = (
    await tx.execute<{ d: string; indicator: string; total: number; n: number }>(sql`WITH ${cs}
      SELECT to_char(coalesce(m.started_at, m.created_at), 'YYYY-MM-DD') AS d, i.indicator,
        sum(i.score)::float AS total, count(*)::int AS n
      FROM intelligence_indicators i JOIN meetings m ON m.id = i.meeting_id
      WHERE i.score IS NOT NULL AND ${meetingIn} AND ${inRanges(sql`coalesce(m.started_at, m.created_at)`)}
      GROUP BY 1, 2`)
  ).rows;
  const oppDaily = (
    await tx.execute<{ d: string; kind: "identified" | "won"; n: number }>(sql`WITH ${cs}
      SELECT to_char(o.created_at, 'YYYY-MM-DD') AS d, 'identified' AS kind, count(*)::int AS n
        FROM expansion_opportunities o WHERE o.customer_id IN (SELECT id FROM fc) AND ${inRanges(sql`o.created_at`)} GROUP BY 1
      UNION ALL
      SELECT to_char(o.updated_at, 'YYYY-MM-DD'), 'won', count(*)::int
        FROM expansion_opportunities o WHERE o.status = 'won' AND o.customer_id IN (SELECT id FROM fc) AND ${inRanges(sql`o.updated_at`)} GROUP BY 1`)
  ).rows;
  const taskDaily = (
    await tx.execute<{
      d: string;
      kind: "created" | "completed";
      n: number;
      valid: number;
      done: number;
      days: number | null;
    }>(sql`WITH ${cs}
      SELECT to_char(t.created_at, 'YYYY-MM-DD') AS d, 'created' AS kind, count(*)::int AS n,
        count(*) FILTER (WHERE t.status <> 'cancelled')::int AS valid,
        count(*) FILTER (WHERE t.status = 'done')::int AS done, NULL::float AS days
        FROM action_tasks t WHERE ${taskIn} AND ${inRanges(sql`t.created_at`)} GROUP BY 1
      UNION ALL
      SELECT to_char(t.completed_at, 'YYYY-MM-DD'), 'completed', count(*)::int, 0, 0,
        sum(extract(epoch FROM t.completed_at - t.created_at) / 86400)::float
        FROM action_tasks t WHERE t.status = 'done' AND t.completed_at IS NOT NULL AND ${taskIn}
          AND ${inRanges(sql`t.completed_at`)} GROUP BY 1`)
  ).rows;
  const riskDaily = (
    await tx.execute<{ d: string; customer_id: string; rev: number | null }>(sql`WITH ${cs}
      SELECT to_char(s.first_seen_at, 'YYYY-MM-DD') AS d, s.customer_id, max(s.revenue_at_risk_cents)::float AS rev
      FROM churn_signals s WHERE s.customer_id IN (SELECT id FROM fc) AND ${inRanges(sql`s.first_seen_at`)}
      GROUP BY 1, 2`)
  ).rows;

  const sumIn = <T extends { d: string }>(rows: T[], b: Bucket, v: (r: T) => number) =>
    rows.filter((r) => inBucket(r.d, b)).reduce((s, r) => s + v(r), 0);
  const whole = { label: "", start: from, end: to };
  const wholeCmp = { label: "", start: c.from, end: c.to };

  /* ------------------------------------------------------- resumo atual -- */
  const now = (
    await tx.execute<{
      active: number;
      revenue: number | null;
      impacted: number;
      without_rev: number;
      open_opps: number;
      opp_customers: number;
      qualified: number;
      potential: number | null;
    }>(sql`WITH ${cs},
      os AS (SELECT s.customer_id, max(s.revenue_at_risk_cents) AS rev FROM churn_signals s
             WHERE s.status = 'open' AND s.customer_id IN (SELECT id FROM fc) GROUP BY s.customer_id)
      SELECT (SELECT count(*)::int FROM fc) AS active,
        (SELECT sum(rev)::float FROM os) AS revenue,
        (SELECT count(*)::int FROM os) AS impacted,
        (SELECT count(*)::int FROM os WHERE rev IS NULL) AS without_rev,
        (SELECT count(*)::int FROM expansion_opportunities o WHERE o.status IN ('open','qualified') AND o.customer_id IN (SELECT id FROM fc)) AS open_opps,
        (SELECT count(DISTINCT o.customer_id)::int FROM expansion_opportunities o WHERE o.status IN ('open','qualified') AND o.customer_id IN (SELECT id FROM fc)) AS opp_customers,
        (SELECT count(*)::int FROM expansion_opportunities o WHERE o.status = 'qualified' AND o.customer_id IN (SELECT id FROM fc)) AS qualified,
        (SELECT sum(o.potential_cents)::float FROM expansion_opportunities o WHERE o.status IN ('open','qualified') AND o.customer_id IN (SELECT id FROM fc)) AS potential`)
  ).rows[0]!;

  /* Movimentação de risco entre o início e o fim do período. */
  const mv = (
    await tx.execute<{
      comparable: number;
      without_history: number;
      entered: number;
      remained: number;
      recovered: number;
      improved: number;
      worsened: number;
      recovered_rev: number | null;
    }>(sql`WITH ${cs},
      a AS (SELECT DISTINCT ON (customer_id) customer_id, score, classification FROM customer_health_snapshots
            WHERE score IS NOT NULL AND created_at < ${from}::date AND customer_id IN (SELECT id FROM fc)
            ORDER BY customer_id, created_at DESC),
      b AS (SELECT DISTINCT ON (customer_id) customer_id, score, classification FROM customer_health_snapshots
            WHERE score IS NOT NULL AND created_at < ${to}::date + 1 AND customer_id IN (SELECT id FROM fc)
            ORDER BY customer_id, created_at DESC)
      SELECT count(a.customer_id)::int AS comparable,
        count(*) FILTER (WHERE a.customer_id IS NULL)::int AS without_history,
        count(*) FILTER (WHERE a.classification <> 'high_risk' AND b.classification = 'high_risk')::int AS entered,
        count(*) FILTER (WHERE a.classification = 'high_risk' AND b.classification = 'high_risk')::int AS remained,
        count(*) FILTER (WHERE a.classification = 'high_risk' AND b.classification <> 'high_risk')::int AS recovered,
        count(*) FILTER (WHERE b.score > a.score)::int AS improved,
        count(*) FILTER (WHERE b.score < a.score)::int AS worsened,
        sum(fc.mrr_cents) FILTER (WHERE a.classification = 'high_risk' AND b.classification <> 'high_risk')::float AS recovered_rev
      FROM b LEFT JOIN a ON a.customer_id = b.customer_id JOIN fc ON fc.id = b.customer_id`)
  ).rows[0]!;

  /* Fatores de risco abertos. */
  const factors = (
    await tx.execute<{
      factor_key: string;
      factor_label: string;
      customers: number;
      new_p: number;
      new_c: number;
      refs: { id: string; name: string }[];
    }>(sql`WITH ${cs}
      SELECT s.factor_key, max(s.factor_label) AS factor_label, count(DISTINCT s.customer_id) FILTER (WHERE s.status = 'open')::int AS customers,
        count(*) FILTER (WHERE s.first_seen_at::date BETWEEN ${from}::date AND ${to}::date)::int AS new_p,
        count(*) FILTER (WHERE s.first_seen_at::date BETWEEN ${c.from}::date AND ${c.to}::date)::int AS new_c,
        coalesce((SELECT json_agg(json_build_object('id', x.id, 'name', x.name)) FROM (
           SELECT DISTINCT fc.id, fc.name FROM churn_signals s2 JOIN fc ON fc.id = s2.customer_id
           WHERE s2.factor_key = s.factor_key AND s2.status = 'open' ORDER BY fc.name LIMIT 6) x), '[]'::json) AS refs
      FROM churn_signals s WHERE s.customer_id IN (SELECT id FROM fc)
      GROUP BY s.factor_key
      HAVING count(*) FILTER (WHERE s.status = 'open') > 0
      ORDER BY customers DESC, s.factor_key LIMIT 10`)
  ).rows;

  /* Clientes: base do drill-down e do ranking de prioridade. */
  const customers = (
    await tx.execute<{
      id: string;
      name: string;
      segment: string | null;
      owner_name: string | null;
      score: number | null;
      classification: HealthClass | null;
      mrr: number | null;
      open_risks: number;
      max_sev: string | null;
      main_factor: string | null;
      rev: number | null;
      opps: number;
      pending: number;
      overdue: number;
      last_analysis: string | null;
      plan_title: string | null;
      next_action: string | null;
    }>(sql`WITH ${cs}
      SELECT fc.id, fc.name, fc.segment, u.name AS owner_name, fc.score, fc.classification, fc.mrr_cents::float AS mrr,
        (SELECT count(*)::int FROM churn_signals s WHERE s.customer_id = fc.id AND s.status = 'open') AS open_risks,
        top.severity AS max_sev, top.factor_label AS main_factor,
        (SELECT max(s.revenue_at_risk_cents)::float FROM churn_signals s WHERE s.customer_id = fc.id AND s.status = 'open') AS rev,
        (SELECT count(*)::int FROM expansion_opportunities o WHERE o.customer_id = fc.id AND o.status IN ('open','qualified')) AS opps,
        (SELECT count(*)::int FROM action_tasks t WHERE t.customer_id = fc.id AND t.status IN ('pending','in_progress')) AS pending,
        (SELECT count(*)::int FROM action_tasks t WHERE t.customer_id = fc.id AND t.status IN ('pending','in_progress') AND t.due_date < current_date) AS overdue,
        (SELECT to_char(max(a.completed_at), 'YYYY-MM-DD') FROM meeting_analyses a JOIN meetings m ON m.id = a.meeting_id
           WHERE m.customer_id = fc.id AND a.status = 'completed') AS last_analysis,
        (SELECT p.title FROM action_plans p WHERE p.customer_id = fc.id ORDER BY p.created_at DESC LIMIT 1) AS plan_title,
        coalesce(top.next_action, (SELECT t.title FROM action_tasks t WHERE t.customer_id = fc.id AND t.status IN ('pending','in_progress')
           ORDER BY t.due_date NULLS LAST, t.created_at LIMIT 1)) AS next_action
      FROM fc LEFT JOIN users u ON u.id = fc.owner_user_id
      LEFT JOIN LATERAL (SELECT s.severity, s.factor_label, s.next_action FROM churn_signals s
        WHERE s.customer_id = fc.id AND s.status = 'open'
        ORDER BY CASE s.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, s.last_seen_at DESC LIMIT 1) top ON true
      ORDER BY fc.score ASC NULLS LAST, fc.name LIMIT 1000`)
  ).rows;

  const ranking = (
    await tx.execute<{
      id: string;
      customer_id: string;
      customer_name: string;
      type: string;
      need: string;
      evidence: string | null;
      owner_name: string | null;
      status: string;
      next_action: string | null;
      potential: number | null;
    }>(sql`WITH ${cs}
      SELECT o.id, fc.id AS customer_id, fc.name AS customer_name, o.type_label AS type, o.need,
        o.evidence->0->>'text' AS evidence, coalesce(ou.name, cu.name) AS owner_name, o.status, o.next_action,
        o.potential_cents::float AS potential
      FROM expansion_opportunities o JOIN fc ON fc.id = o.customer_id
      LEFT JOIN users ou ON ou.id = o.owner_user_id LEFT JOIN users cu ON cu.id = fc.owner_user_id
      WHERE o.status IN ('open','qualified')
      ORDER BY CASE o.status WHEN 'qualified' THEN 0 ELSE 1 END, o.potential_cents DESC NULLS LAST, o.created_at DESC LIMIT 15`)
  ).rows;

  /* --------------------------------------------------------- montagem -- */
  const score = avgAt(to);
  const health = at(to);
  const cmpHealth = at(c.to);
  const tNow = tasksAt.get(to)!;
  const tCmp = tasksAt.get(c.to)!;
  const healthSpark = (k?: "healthy" | "attention" | "high") =>
    buckets.map((b) => (k ? countAt(b.end, k) : avgAt(b.end)));
  const meetingsIn = (b: Bucket) => sumIn(meetingsDaily, b, (r) => r.n);
  const oppIn = (b: Bucket, k: "identified" | "won") =>
    sumIn(
      oppDaily.filter((r) => r.kind === k),
      b,
      (r) => r.n,
    );
  const createdRows = taskDaily.filter((r) => r.kind === "created");
  const completedRows = taskDaily.filter((r) => r.kind === "completed");
  const rate = (b: Bucket) => {
    const valid = sumIn(createdRows, b, (r) => r.valid);
    return valid ? Math.round((sumIn(createdRows, b, (r) => r.done) / valid) * 1000) / 10 : null;
  };
  const completedP = sumIn(completedRows, whole, (r) => r.n);
  const daysP = sumIn(completedRows, whole, (r) => r.days ?? 0);
  const newRevenue = (b: Bucket) => {
    const rows = riskDaily.filter((r) => inBucket(r.d, b));
    if (!rows.length) return 0;
    const per = new Map<string, number | null>();
    for (const r of rows) {
      const prev = per.get(r.customer_id);
      per.set(r.customer_id, r.rev === null ? (prev ?? null) : Math.max(prev ?? 0, r.rev));
    }
    const vals = [...per.values()].filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  };
  const shareOf = (v: number | null, base: number) => (v === null || !base ? null : v / base);
  const hasHealthHistory = cmpHealth.n > 0;
  const healthNote = `Situação em ${c.to.split("-").reverse().join("/")} (fim do período de comparação)`;

  const kpis: BiKpi[] = [
    {
      key: "active_customers",
      value: Number(now.active),
      share: null,
      direction: "up_is_good",
      comparison: na("Sem histórico de entrada e saída de clientes para comparar"),
      spark: [],
      source: "Clientes com status ativo na carteira, dentro dos filtros.",
    },
    {
      key: "average_health",
      value: score,
      share: null,
      direction: "up_is_good",
      comparison: cmp(score, avgAt(c.to), hasHealthHistory, healthNote),
      spark: healthSpark(),
      source: "Média da última nota de Customer Health de cada cliente até o fim do período.",
    },
    ...(
      [
        ["healthy", "healthy", "up_is_good", "Clientes cuja última nota até o fim do período é saudável."],
        [
          "attention",
          "attention",
          "down_is_good",
          "Clientes cuja última nota até o fim do período é de atenção.",
        ],
        [
          "high_risk",
          "high",
          "down_is_good",
          "Clientes cuja última nota até o fim do período é de risco alto.",
        ],
      ] as const
    ).map(([key, k, direction, source]): BiKpi => ({
      key,
      value: countAt(to, k),
      share: shareOf(countAt(to, k), health.n),
      direction,
      comparison: cmp(countAt(to, k), countAt(c.to, k), hasHealthHistory, healthNote),
      spark: healthSpark(k),
      source: `${source} Percentual sobre os clientes com nota.`,
    })),
    {
      key: "revenue_at_risk",
      value: now.revenue === null ? null : Number(now.revenue),
      share: null,
      direction: "down_is_good",
      comparison: na("Sinais de risco não guardam histórico de abertura e fechamento por data"),
      spark: [],
      source:
        "Soma da receita em risco informada nos sinais de churn abertos (uma vez por cliente). Sem valor informado, não é estimada.",
    },
    {
      key: "expansion",
      value: Number(now.open_opps),
      share: shareOf(Number(now.opp_customers), Number(now.active)),
      direction: "up_is_good",
      comparison: cmp(
        oppIn(whole, "identified"),
        oppIn(wholeCmp, "identified"),
        flowHistory,
        `Novas no período: ${oppIn(whole, "identified")}`,
      ),
      spark: buckets.map((b) => oppIn(b, "identified")),
      source:
        "Oportunidades abertas ou qualificadas agora. A variação compara as oportunidades identificadas em cada período.",
    },
    {
      key: "analyzed_meetings",
      value: meetingsIn(whole),
      share: null,
      direction: "up_is_good",
      comparison: cmp(meetingsIn(whole), meetingsIn(wholeCmp), flowHistory),
      spark: buckets.map(meetingsIn),
      source: "Reuniões do período com análise concluída (cada reunião conta uma vez).",
    },
    {
      key: "pending_tasks",
      value: tNow.pending,
      share: null,
      direction: "down_is_good",
      comparison: cmp(tNow.pending, tCmp.pending, tCmp.existed > 0),
      spark: buckets.map((b) => tasksAt.get(b.end)!.pending),
      source: "Tarefas pendentes ou em andamento ao fim do período.",
    },
    {
      key: "overdue_tasks",
      value: tNow.overdue,
      share: shareOf(tNow.overdue, tNow.pending),
      direction: "down_is_good",
      comparison: cmp(tNow.overdue, tCmp.overdue, tCmp.existed > 0),
      spark: buckets.map((b) => tasksAt.get(b.end)!.overdue),
      source: "Tarefas pendentes com prazo vencido ao fim do período. Percentual sobre as pendentes.",
    },
  ];

  const indicatorKeys = [...new Set(indDaily.map((r) => r.indicator))].sort();
  const avgInd = (k: string, b: Bucket) => {
    const rows = indDaily.filter((r) => r.indicator === k && inBucket(r.d, b));
    const n = rows.reduce((s, r) => s + r.n, 0);
    return n ? Math.round((rows.reduce((s, r) => s + r.total, 0) / n) * 10) / 10 : null;
  };

  const prevMonth = avgAt(prevMonthEnd);
  const prevYear = avgAt(addYears(to, -1));
  return {
    period: { from, to, compare: mode, compareFrom: c.from, compareTo: c.to, granularity },
    bands,
    gauge: {
      score,
      classification: classify(score),
      previousMonth: prevMonth,
      previousYear: prevYear,
      monthDeltaPct: pct(score, prevMonth),
      yearDeltaPct: pct(score, prevYear),
      customersWithHealth: health.n,
      activeCustomers: Number(now.active),
    },
    kpis,
    buckets,
    healthSeries: buckets.map((b, i) => ({ value: avgAt(b.end), previous: avgAt(cbuckets[i]!.end) })),
    meetingsSeries: buckets.map((b, i) => ({ value: meetingsIn(b), previous: meetingsIn(cbuckets[i]!) })),
    // Mesma base dos KPIs (situação ao fim do período), para os números baterem
    distribution: {
      healthy: health.healthy,
      attention: health.attention,
      highRisk: health.high,
      noData: Math.max(Number(now.active) - health.n, 0),
    },
    movement: {
      comparable: mv.comparable,
      withoutHistory: mv.without_history,
      entered: mv.entered,
      remained: mv.remained,
      recovered: mv.recovered,
      improved: mv.improved,
      worsened: mv.worsened,
    },
    churn: {
      factors: factors.map((r) => ({
        factorKey: r.factor_key,
        label: RISK_SIGNALS.find((x) => x.key === r.factor_key)?.label ?? r.factor_label,
        customers: r.customers,
        share: shareOf(r.customers, Number(now.active)),
        newInPeriod: r.new_p,
        newInComparison: r.new_c,
        customerRefs: r.refs,
      })),
      revenue: {
        atRiskCents: now.revenue === null ? null : Number(now.revenue),
        impactedCustomers: now.impacted,
        customersWithoutRevenue: now.without_rev,
        recoveredCents: mv.recovered === 0 ? 0 : mv.recovered_rev,
        recoveredCustomers: mv.recovered,
        series: buckets.map(newRevenue),
      },
      priority: customers
        .filter(
          (x) =>
            x.classification === "high_risk" ||
            x.max_sev === "critical" ||
            x.max_sev === "high" ||
            x.overdue > 0,
        )
        .sort((a, b) => {
          const sev = (s: string | null) => ["critical", "high", "medium", "low"].indexOf(s ?? "") + 1 || 9;
          return sev(a.max_sev) - sev(b.max_sev) || (a.score ?? 101) - (b.score ?? 101);
        })
        .slice(0, 15)
        .map((x) => ({
          id: x.id,
          name: x.name,
          healthScore: x.score,
          healthClass: x.classification,
          maxSeverity: x.max_sev,
          mainFactor: x.main_factor,
          lastAnalysisAt: x.last_analysis,
          planTitle: x.plan_title,
          openTasks: x.pending,
          ownerName: x.owner_name,
          nextAction: x.next_action,
        })),
    },
    expansion: {
      identified: oppIn(whole, "identified"),
      identifiedComparison: oppIn(wholeCmp, "identified"),
      customersWithPotential: now.opp_customers,
      inFollowUp: now.qualified,
      potentialCents: now.potential === null ? null : Number(now.potential),
      converted: oppIn(whole, "won"),
      convertedComparison: oppIn(wholeCmp, "won"),
      series: buckets.map((b) => ({ identified: oppIn(b, "identified"), converted: oppIn(b, "won") })),
      ranking: ranking.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        type: r.type,
        need: r.need,
        evidence: r.evidence,
        ownerName: r.owner_name,
        status: r.status,
        nextAction: r.next_action,
        potentialCents: r.potential,
      })),
    },
    plans: {
      created: sumIn(createdRows, whole, (r) => r.n),
      createdComparison: sumIn(createdRows, wholeCmp, (r) => r.n),
      completed: completedP,
      completedComparison: sumIn(completedRows, wholeCmp, (r) => r.n),
      pending: tNow.pending,
      overdue: tNow.overdue,
      completionRate: rate(whole),
      completionRateComparison: rate(wholeCmp),
      avgCompletionDays: completedP ? Math.round((daysP / completedP) * 10) / 10 : null,
      series: buckets.map((b) => ({
        created: sumIn(createdRows, b, (r) => r.n),
        completed: sumIn(completedRows, b, (r) => r.n),
      })),
    },
    indicators: indicatorKeys.map((k) => {
      const rows = indDaily.filter((r) => r.indicator === k && inBucket(r.d, whole));
      return {
        indicator: k,
        average: avgInd(k, whole),
        previous: avgInd(k, wholeCmp),
        samples: rows.reduce((s, r) => s + r.n, 0),
        series: buckets.map((b) => avgInd(k, b)),
      };
    }),
    customers: customers.map((x) => ({
      id: x.id,
      name: x.name,
      segment: x.segment,
      ownerName: x.owner_name,
      healthScore: x.score,
      healthClass: x.classification,
      mrrCents: x.mrr,
      openRisks: x.open_risks,
      maxSeverity: x.max_sev,
      mainFactor: x.main_factor,
      revenueAtRiskCents: x.rev,
      openOpportunities: x.opps,
      pendingTasks: x.pending,
      overdueTasks: x.overdue,
      lastAnalysisAt: x.last_analysis,
    })),
    filtersApplied: { ...f, from, to, compare: mode },
  };
}

export async function biRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/reports/bi",
    {
      schema: { tags: ["reports"], querystring: BiFilters, response: { 200: ReportBi } },
      preHandler: requirePermission("reports.read"),
    },
    async (req) => tenantTx(req, (tx) => bi(tx, req.query)),
  );
}
