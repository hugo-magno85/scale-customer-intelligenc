import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comparisonRange, makeBuckets } from "../src/routes/bi.js";
import { client, login, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
let admin = "";
let other = "";
let tenant = "";
let otherTenant = "";
let me = "";
const ids: Record<string, string> = {};
const today = new Date().toISOString().slice(0, 10);

async function seed(sqlText: string, params: unknown[]) {
  const c = new pg.Client({ connectionString: ctx.db.ownerUrl });
  await c.connect();
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
  const r = await c.query(sqlText, params);
  await c.query("COMMIT");
  await c.end();
  return r.rows;
}

beforeAll(async () => {
  ctx = await setup();
  const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
  tenant = (
    await s.post("/platform/tenants", {
      name: "BI Co",
      slug: "bi-co",
      admin: { name: "Ana", email: "ana@bi.com", password: "senha-ana-123456" },
    })
  ).json().id;
  otherTenant = (
    await s.post("/platform/tenants", {
      name: "Outra BI",
      slug: "outra-bi",
      admin: { name: "Bia", email: "bia@bi2.com", password: "senha-bia-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@bi.com", "senha-ana-123456");
  other = await login(ctx, "bia@bi2.com", "senha-bia-123456");
  const a = client(ctx, admin, tenant);
  me = (await a.get("/auth/me")).json().id;
  ids.acme = (await a.post("/customers", { name: "ACME", segment: "Indústria", mrrCents: 500000 })).json().id;
  ids.beta = (await a.post("/customers", { name: "Beta", segment: "Serviços", mrrCents: 300000 })).json().id;
  ids.gama = (await a.post("/customers", { name: "Gama", segment: "Indústria" })).json().id;
  ids.delta = (await a.post("/customers", { name: "Delta", segment: "Serviços" })).json().id;

  // Histórico: ACME saiu do risco (recuperado); Beta entrou em risco; Gama só tem nota recente.
  await seed(
    `INSERT INTO customer_health_snapshots (tenant_id, customer_id, score, classification, weights, created_at) VALUES
      ($1,$2,30,'high_risk','{}', now() - interval '120 days'),
      ($1,$2,75,'healthy','{}',  now() - interval '5 days'),
      ($1,$3,80,'healthy','{}',  now() - interval '120 days'),
      ($1,$3,35,'high_risk','{}', now() - interval '10 days'),
      ($1,$4,50,'attention','{}', now() - interval '3 days')`,
    [tenant, ids.acme, ids.beta, ids.gama],
  );
  await seed(
    `INSERT INTO churn_signals (tenant_id, customer_id, factor_key, factor_label, severity, evidence, recommendation, revenue_at_risk_cents, first_seen_at)
     VALUES ($1,$2,'cancellation_intent','Intenção de cancelamento','critical','[{"segmentId":1,"speaker":"customer","text":"vamos cancelar","startMs":0}]','Recuperar',300000, now() - interval '10 days'),
            ($1,$2,'low_adoption','Baixa adoção','high','[{"segmentId":2,"speaker":"customer","text":"usando pouco","startMs":0}]','Treinar',300000, now() - interval '10 days'),
            ($1,$3,'low_adoption','Baixa adoção','medium','[{"segmentId":3,"speaker":"customer","text":"pouco uso","startMs":0}]','Treinar',NULL, now() - interval '3 days')`,
    [tenant, ids.beta, ids.gama],
  );
  // Reuniões analisadas: 2 no período atual (uma com duas versões de análise), 1 no anterior
  const meetings = await seed(
    `INSERT INTO meetings (tenant_id, owner_user_id, platform, customer_id, status, consent_confirmed_at, consent_method, started_at, created_at)
     VALUES ($1,$2,'google_meet',$3,'analyzed', now(), 'verbal_announcement', now() - interval '5 days', now() - interval '5 days'),
            ($1,$2,'google_meet',$4,'analyzed', now(), 'verbal_announcement', now() - interval '10 days', now() - interval '10 days'),
            ($1,$2,'google_meet',$3,'analyzed', now(), 'verbal_announcement', now() - interval '120 days', now() - interval '120 days')
     RETURNING id`,
    [tenant, me, ids.acme, ids.beta],
  );
  const [m1, m2, m3] = meetings.map((r) => r.id as string);
  await seed(
    `INSERT INTO meeting_analyses (tenant_id, meeting_id, version, status, mode, completed_at) VALUES
      ($1,$2,1,'completed','full', now() - interval '5 days'),
      ($1,$2,2,'completed','full', now() - interval '4 days'),
      ($1,$3,1,'completed','full', now() - interval '10 days'),
      ($1,$4,1,'completed','full', now() - interval '120 days')`,
    [tenant, m1, m2, m3],
  );
  await seed(
    `INSERT INTO action_tasks (tenant_id, customer_id, title, status, due_date, created_at, completed_at) VALUES
      ($1,$2,'Treinar equipe','pending', current_date - 2, now() - interval '20 days', NULL),
      ($1,$2,'Reunião executiva','done', current_date + 5, now() - interval '20 days', now() - interval '10 days'),
      ($1,$3,'Plano antigo','done', NULL, now() - interval '150 days', now() - interval '100 days')`,
    [tenant, ids.beta, ids.acme],
  );
  await seed(
    `INSERT INTO expansion_opportunities (tenant_id, customer_id, type, type_label, need, evidence, status, potential_cents, created_at)
     VALUES ($1,$2,'new_area','Nova área','Nova filial','[{"segmentId":9,"speaker":"customer","text":"nova filial","startMs":0}]','qualified',200000, now() - interval '5 days')`,
    [tenant, ids.acme],
  );
});
afterAll(async () => ctx?.close());

const kpi = (r: { kpis: { key: string }[] }, k: string) =>
  r.kpis.find((x) => x.key === k) as {
    value: number | null;
    share: number | null;
    comparison: { status: string; previous: number | null; deltaPct: number | null };
    spark: (number | null)[];
  };

describe("BI executivo", () => {
  it("períodos de comparação têm o mesmo tamanho; buckets cobrem o período", () => {
    expect(comparisonRange("2026-04-01", "2026-04-30", "previous")).toEqual({
      from: "2026-03-02",
      to: "2026-03-31",
    });
    expect(comparisonRange("2026-04-01", "2026-04-30", "year")).toEqual({
      from: "2025-04-01",
      to: "2025-04-30",
    });
    const w = makeBuckets("2026-01-01", "2026-03-31");
    expect(w.granularity).toBe("week");
    expect(w.buckets[0]!.start).toBe("2026-01-01");
    expect(w.buckets.at(-1)!.end).toBe("2026-03-31");
    const m = makeBuckets("2025-12-15", "2026-11-26");
    expect(m.granularity).toBe("month");
    expect(m.buckets.map((b) => b.label)).toContain("jan/26");
    expect(m.buckets[0]!.start).toBe("2025-12-15");
  });

  it("KPIs como estavam no fim do período, com comparação só quando há histórico", async () => {
    const r = (await client(ctx, admin, tenant).get(`/reports/bi?from=${addDays(-89)}&to=${today}`)).json();
    expect(r.period.granularity).toBe("week");
    expect(kpi(r, "active_customers").value).toBe(4);
    expect(kpi(r, "active_customers").comparison.status).toBe("not_applicable");
    // ACME 75, Beta 35, Gama 50 → média 53,3
    expect(kpi(r, "average_health").value).toBe(53.3);
    // 90 dias antes: ACME 30 e Beta 80 → 55
    expect(kpi(r, "average_health").comparison).toMatchObject({ status: "ok", previous: 55 });
    expect(kpi(r, "high_risk")).toMatchObject({ value: 1, share: 1 / 3 });
    expect(kpi(r, "high_risk").comparison.previous).toBe(1);
    // Receita em risco: Beta conta uma vez (300000); Gama sem valor não vira zero estimado
    expect(kpi(r, "revenue_at_risk").value).toBe(300000);
    expect(r.churn.revenue).toMatchObject({ impactedCustomers: 2, customersWithoutRevenue: 1 });
    // Reunião com duas versões de análise conta uma vez
    expect(kpi(r, "analyzed_meetings").value).toBe(2);
    expect(kpi(r, "pending_tasks").value).toBe(1);
    expect(kpi(r, "overdue_tasks").value).toBe(1);
    expect(r.distribution).toEqual({ healthy: 1, attention: 1, highRisk: 1, noData: 1 });
    expect(r.gauge.customersWithHealth).toBe(3);
  });

  it("movimentação de risco e receita recuperada vêm dos snapshots", async () => {
    const r = (await client(ctx, admin, tenant).get(`/reports/bi?from=${addDays(-89)}&to=${today}`)).json();
    expect(r.movement).toMatchObject({
      comparable: 2,
      withoutHistory: 1,
      entered: 1,
      recovered: 1,
      remained: 0,
      improved: 1,
      worsened: 1,
    });
    expect(r.churn.revenue).toMatchObject({ recoveredCustomers: 1, recoveredCents: 500000 });
    expect(r.churn.factors[0]).toMatchObject({ factorKey: "low_adoption", customers: 2, newInPeriod: 2 });
    expect(r.churn.priority[0].name).toBe("Beta");
    expect(r.expansion).toMatchObject({
      identified: 1,
      customersWithPotential: 1,
      inFollowUp: 1,
      potentialCents: 200000,
    });
    expect(r.plans).toMatchObject({ created: 2, completed: 1, completionRate: 50 });
    expect(r.plans.avgCompletionDays).toBeCloseTo(10, 0);
  });

  it("sem histórico: comparação com o ano anterior não inventa números", async () => {
    const r = (
      await client(ctx, admin, tenant).get(`/reports/bi?from=${addDays(-29)}&to=${today}&compare=year`)
    ).json();
    expect(kpi(r, "average_health").comparison.status).toBe("no_history");
    expect(kpi(r, "average_health").comparison.previous).toBeNull();
    expect(kpi(r, "analyzed_meetings").comparison.status).toBe("no_history");
    expect(r.gauge.previousYear).toBeNull();
  });

  it("filtros globais valem para tudo e não há vazamento entre tenants", async () => {
    const r = (
      await client(ctx, admin, tenant).get(`/reports/bi?from=${addDays(-89)}&to=${today}&segment=Indústria`)
    ).json();
    expect(kpi(r, "active_customers").value).toBe(2);
    expect(r.customers.map((c: { name: string }) => c.name).sort()).toEqual(["ACME", "Gama"]);
    expect(kpi(r, "analyzed_meetings").value).toBe(1);
    const o = (await client(ctx, other, otherTenant).get("/reports/bi")).json();
    expect(kpi(o, "active_customers").value).toBe(0);
    expect(kpi(o, "average_health").value).toBeNull();
    expect(o.gauge.score).toBeNull();
    expect(o.customers).toEqual([]);
  });
});

function addDays(n: number) {
  return new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
}
