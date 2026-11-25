import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toCsv } from "../src/routes/reports.js";
import { client, login, ORIGIN, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
let admin = "";
let tenant = "";
let other = "";
let otherTenant = "";
const ids: Record<string, string> = {};

/** Insere dados analíticos direto no banco (como o worker faria), sob o contexto do tenant. */
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
      name: "Rep Co",
      slug: "rep-co",
      admin: { name: "Ana", email: "ana@rep.com", password: "senha-ana-123456" },
    })
  ).json().id;
  otherTenant = (
    await s.post("/platform/tenants", {
      name: "Outra",
      slug: "outra-rep",
      admin: { name: "Bia", email: "bia@rep2.com", password: "senha-bia-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@rep.com", "senha-ana-123456");
  other = await login(ctx, "bia@rep2.com", "senha-bia-123456");
  const a = client(ctx, admin, tenant);
  const me = (await a.get("/auth/me")).json();
  ids.acme = (
    await a.post("/customers", { name: "ACME", segment: "Indústria", ownerUserId: me.id, mrrCents: 1000000 })
  ).json().id;
  ids.beta = (await a.post("/customers", { name: '=HYPERLINK("x")', segment: "Serviços" })).json().id;
  ids.gama = (await a.post("/customers", { name: "Gama", segment: "Indústria" })).json().id;
  await seed(
    `INSERT INTO customer_health_snapshots (tenant_id, customer_id, score, classification, weights, created_at) VALUES
      ($1,$2,35,'high_risk','{}', now() - interval '20 days'),
      ($1,$3,82,'healthy','{}', now() - interval '3 days'),
      ($1,$2,30,'high_risk','{}', now() - interval '2 days')`,
    [tenant, ids.acme, ids.beta],
  );
  await seed(
    `INSERT INTO churn_signals (tenant_id, customer_id, factor_key, factor_label, severity, evidence, recommendation, revenue_at_risk_cents)
     VALUES ($1,$2,'cancellation_intent','Intenção de cancelamento','critical','[{"segmentId":1,"speaker":"customer","text":"vamos cancelar","startMs":0}]','Recuperar',1000000),
            ($1,$2,'low_adoption','Baixa adoção','high','[{"segmentId":2,"speaker":"customer","text":"usando pouco","startMs":0}]','Treinar',1000000)`,
    [tenant, ids.acme],
  );
});
afterAll(async () => ctx?.close());

describe("relatórios", () => {
  it("visão geral sem filtros: números reais, sem duplicar receita por cliente", async () => {
    const r = (await client(ctx, admin, tenant).get("/reports/overview")).json();
    expect(r.summary).toMatchObject({
      activeCustomers: 3,
      healthy: 1,
      highRisk: 1,
      attention: 0,
      averageHealth: 56,
      revenueAtRiskCents: 1000000,
    });
    expect(r.topRiskFactors.map((x: { factorKey: string }) => x.factorKey)).toEqual([
      "cancellation_intent",
      "low_adoption",
    ]);
    expect(r.weekly.length).toBeGreaterThan(10);
    expect(r.weekly.some((w: { averageHealth: number | null }) => w.averageHealth !== null)).toBe(true);
    expect(r.customers[0]).toMatchObject({
      name: "ACME",
      healthClass: "high_risk",
      openRisks: 2,
      maxSeverity: "critical",
    });
  });

  it("filtros: segmento, saúde, risco e responsável", async () => {
    const a = client(ctx, admin, tenant);
    expect((await a.get("/reports/overview?segment=Ind%C3%BAstria")).json().summary.activeCustomers).toBe(2);
    expect(
      (await a.get("/reports/overview?health=healthy")).json().customers.map((c: { id: string }) => c.id),
    ).toEqual([ids.beta]);
    expect(
      (await a.get("/reports/overview?risk=critical")).json().customers.map((c: { id: string }) => c.id),
    ).toEqual([ids.acme]);
    const me = (await a.get("/auth/me")).json();
    const byOwner = (await a.get(`/reports/overview?ownerUserId=${me.id}`)).json();
    expect(byOwner.summary.activeCustomers).toBe(1);
    expect(byOwner.summary.averageHealth).toBe(30);
  });

  it("exporta CSV com BOM, separador ; e proteção contra fórmula", async () => {
    const r = await ctx.app.inject({
      url: "/v1/reports/export?type=customers",
      headers: { origin: ORIGIN, "x-tenant-id": tenant },
      cookies: { sci_session: admin },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.headers["content-disposition"]).toContain("scale-customers-");
    expect(r.body.startsWith("﻿Cliente;Segmento")).toBe(true);
    expect(r.body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(r.body).not.toMatch(/\n=HYPERLINK/);
    const churn = await ctx.app.inject({
      url: "/v1/reports/export?type=churn",
      headers: { origin: ORIGIN, "x-tenant-id": tenant },
      cookies: { sci_session: admin },
    });
    expect(churn.body).toContain("vamos cancelar");
    expect(churn.body).toContain("Crítico");
    expect(churn.body).toContain("10000,00");
    expect(r.body).toContain("Risco alto");
  });

  it("toCsv escapa aspas, quebras de linha e prefixos perigosos", () => {
    const csv = toCsv(
      [{ a: '+1"2', b: "linha\nnova", c: null, d: "@x" }],
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
        { key: "c", label: "C" },
        { key: "d", label: "D" },
      ],
    );
    expect(csv).toBe('﻿A;B;C;D\r\n"\'+1""2";"linha\nnova";;\'@x');
  });

  it("isolamento: outro tenant não vê dados nem exporta", async () => {
    const o = (await client(ctx, other, otherTenant).get("/reports/overview")).json();
    expect(o.summary.activeCustomers).toBe(0);
    expect(o.topRiskFactors).toEqual([]);
    const r = await ctx.app.inject({
      url: "/v1/reports/export?type=churn",
      headers: { origin: ORIGIN, "x-tenant-id": otherTenant },
      cookies: { sci_session: other },
    });
    expect(r.body.split("\r\n")).toHaveLength(1);
  });
});
