import { randomBytes } from "node:crypto";
import { registerCrmClient, type CrmClient } from "@sci/crm-hub";
import { publishAnalysisToCrm, buildCrmComment, riskLabelOf } from "@sci/jobs";
import { keyringFromEnvOrNull } from "@sci/security";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, login, setup, type Ctx } from "./helpers.js";

process.env.SCI_ENCRYPTION_KEYS = `k1:${randomBytes(32).toString("base64")}`;
process.env.SCI_ENCRYPTION_ACTIVE_KEY = "k1";

let ctx: Ctx;
let admin = "";
let tenant = "";
let meeting = "";
let analysisId = "";
let connId = "";

/** CRM simulado: registra o que seria gravado e pode falhar sob demanda. */
const crm = {
  notes: [] as { id: string; body: string }[],
  tasks: [] as { title: string; ownerExternalId: string | null; dueDate: string | null }[],
  fields: [] as Record<string, unknown>[],
  failTask: null as string | null,
};
const fake: CrmClient = {
  validateConnection: async () => ({ accountName: "acme" }),
  getRecord: async (_e, id) => ({
    company: { id: "9", name: "ACME" },
    deal: { id, title: "Renovação", stage: "NEW" },
    contact: null,
    owner: { id: "33", name: "Carla" },
    recordUrl: "https://acme.example/deal/" + id,
  }),
  publishNote: async (_e, _id, note) => {
    crm.notes.push({ id: String(crm.notes.length + 1), body: `${note.title}\n${note.body}` });
    return { externalNoteId: String(crm.notes.length) };
  },
  createTask: async (_e, _id, t) => {
    if (crm.failTask && t.title === crm.failTask) throw new Error("tarefa recusada");
    crm.tasks.push({ title: t.title, ownerExternalId: t.ownerExternalId, dueDate: t.dueDate });
    return { externalTaskId: `t${crm.tasks.length}` };
  },
  updateSummaryFields: async (_e, _id, v) => {
    crm.fields.push(v);
    return { fields: ["UF_CRM_SCI_HEALTH", "UF_CRM_SCI_RISK", "UF_CRM_SCI_LAST_ANALYSIS"], warnings: [] };
  },
};

async function owner<T = Record<string, unknown>>(text: string, params: unknown[]) {
  const c = new pg.Client({ connectionString: ctx.db.ownerUrl });
  await c.connect();
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
  const r = await c.query(text, params);
  await c.query("COMMIT");
  await c.end();
  return r.rows as T[];
}

beforeAll(async () => {
  ctx = await setup();
  registerCrmClient("pipedrive", () => fake);
  const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
  tenant = (
    await s.post("/platform/tenants", {
      name: "Pub Co",
      slug: "pub-co",
      admin: { name: "Ana", email: "ana@pub.com", password: "senha-ana-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@pub.com", "senha-ana-123456");
  const a = client(ctx, admin, tenant);
  const customer = (await a.post("/customers", { name: "ACME" })).json().id;
  meeting = (await a.post("/meetings", { platform: "google_meet", customerId: customer })).json().id;
  connId = (
    await a.post("/crm/connections", {
      provider: "pipedrive",
      label: "CRM",
      externalAccountId: "acme",
      authType: "api_token",
      secret: "0123456789abcdef0123456789abcdef01234567",
    })
  ).json().id;
  expect((await a.post(`/crm/connections/${connId}/validate`)).json().status).toBe("active");
  await a.post(`/meetings/${meeting}/crm-link`, { provider: "pipedrive", reference: "982" });

  // Análise concluída, como o worker gravaria
  analysisId = (
    await owner<{ id: string }>(
      `INSERT INTO meeting_analyses (tenant_id, meeting_id, version, status, mode, summary, diagnosis, result, completed_at)
       VALUES ($1,$2,1,'completed','full','Cliente com baixa adoção.','Equipe não se adaptou.',
       $3::jsonb, now()) RETURNING id`,
      [
        tenant,
        meeting,
        JSON.stringify({
          risks: [
            { label: "Baixa adoção", severity: "high", evidence: [{ text: "usamos pouco" }] },
            { label: "Insatisfação", severity: "medium", evidence: [] },
          ],
          opportunities: [
            { label: "Nova área", need: "Filial nova", evidence: [{ text: "abrimos filial" }] },
          ],
        }),
      ],
    )
  )[0]!.id;
  await owner(
    `INSERT INTO customer_health_snapshots (tenant_id, customer_id, meeting_id, analysis_id, score, classification, weights)
     VALUES ($1,$2,$3,$4,48,'attention','{}')`,
    [tenant, customer, meeting, analysisId],
  );
  const plan = (
    await owner<{ id: string }>(
      `INSERT INTO action_plans (tenant_id, customer_id, meeting_id, analysis_id, title) VALUES ($1,$2,$3,$4,'Plano') RETURNING id`,
      [tenant, customer, meeting, analysisId],
    )
  )[0]!.id;
  await owner(
    `INSERT INTO action_tasks (tenant_id, plan_id, customer_id, meeting_id, title, responsible_party, due_date, status) VALUES
      ($1,$2,$3,$4,'Treinar equipe','internal','2026-12-10','pending'),
      ($1,$2,$3,$4,'Enviar lista de usuários','customer',NULL,'pending'),
      ($1,$2,$3,$4,'Revisar metas','internal',NULL,'pending'),
      ($1,$2,$3,$4,'Tarefa cancelada','internal',NULL,'cancelled')`,
    [tenant, plan, customer, meeting],
  );
});
afterAll(async () => ctx?.close());

describe("envio da análise ao CRM", () => {
  it("comentário com o essencial e risco pelo item mais grave", () => {
    const text = buildCrmComment({
      meetingTitle: "QBR",
      meetingDate: "2026-11-26",
      summary: "Resumo",
      diagnosis: null,
      healthScore: 48,
      healthClass: "attention",
      risks: [{ label: "Baixa adoção", severity: "high", evidence: [{ text: "usamos pouco" }] }],
      opportunities: [],
      nextSteps: [{ title: "Treinar", dueDate: "2026-12-10" }],
      link: "https://x/app/calls/1",
    });
    expect(text).toContain("Customer Health: 4,8/10 — Atenção");
    expect(text).toContain("• Baixa adoção (Alto) — “usamos pouco”");
    expect(text).toContain("• Treinar (até 10/12/2026)");
    expect(text).toContain("Análise completa: https://x/app/calls/1");
    expect(
      riskLabelOf([
        { label: "a", severity: "medium" },
        { label: "b", severity: "critical" },
      ]),
    ).toBe("Crítico");
    expect(riskLabelOf([])).toBe("Sem risco identificado");
  });

  it("envio automático desligado: não grava nada no CRM", async () => {
    const r = await publishAnalysisToCrm(
      { database: ctx.db.app, keyring: keyringFromEnvOrNull(), appUrl: null },
      { tenantId: tenant, analysisId, trigger: "auto", requestedBy: null },
    );
    expect(r).toEqual({ status: "skipped", reason: "Envio automático desligado" });
    expect(crm.notes).toHaveLength(0);
  });

  it("falha parcial: registra o erro e a nova tentativa não duplica o que já foi criado", async () => {
    const a = client(ctx, admin, tenant);
    const s = await a.patch(`/crm/connections/${connId}`, { settings: { autoPublish: true } });
    expect(s.json().settings).toEqual({
      autoPublish: true,
      publishComment: true,
      publishTasks: true,
      publishFields: true,
    });

    crm.failTask = "Revisar metas";
    const r = await publishAnalysisToCrm(
      { database: ctx.db.app, keyring: keyringFromEnvOrNull(), appUrl: "https://ci.example.test" },
      { tenantId: tenant, analysisId, trigger: "auto", requestedBy: null },
    );
    expect(r.status).toBe("failed");
    expect(crm.notes).toHaveLength(1);
    expect(crm.notes[0]!.body).toContain(`https://ci.example.test/app/calls/${meeting}`);
    // Só ações internas e não canceladas; responsável = dono do registro no CRM
    expect(crm.tasks).toEqual([{ title: "Treinar equipe", ownerExternalId: "33", dueDate: "2026-12-10" }]);
    expect(crm.fields).toEqual([
      { healthScore10: 4.8, riskLabel: "Alto", analyzedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
    ]);
    const list = (await a.get(`/meetings/${meeting}/crm-publish`)).json();
    expect(list[0]).toMatchObject({ status: "failed", trigger: "auto", noteId: "1", taskIds: ["t1"] });
    expect(list[0].error).toContain("Revisar metas");

    crm.failTask = null;
    const retry = await a.post(`/meetings/${meeting}/crm-publish`);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ status: "succeeded", taskIds: ["t1", "t2"], noteId: "1" });
    expect(crm.notes).toHaveLength(1); // comentário não repetido
    expect(crm.tasks.map((t) => t.title)).toEqual(["Treinar equipe", "Revisar metas"]);

    const again = await a.post(`/meetings/${meeting}/crm-publish`);
    expect(again.statusCode).toBe(409); // campos já gravados: nada a reenviar
    expect(again.json().error.message).toContain("já foi enviada");
  });

  it("permissões e isolamento", async () => {
    const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
    const other = (
      await s.post("/platform/tenants", {
        name: "Outra Pub",
        slug: "outra-pub",
        admin: { name: "Bia", email: "bia@pub2.com", password: "senha-bia-123456" },
      })
    ).json().id;
    const b = client(ctx, await login(ctx, "bia@pub2.com", "senha-bia-123456"), other);
    expect((await b.get(`/meetings/${meeting}/crm-publish`)).statusCode).toBe(404);
    expect((await b.post(`/meetings/${meeting}/crm-publish`)).statusCode).toBe(404);
  });
});
