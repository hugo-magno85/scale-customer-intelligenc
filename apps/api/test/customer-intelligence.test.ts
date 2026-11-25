import type { AddressInfo } from "node:net";
import type { TranscriptionEvents, TranscriptionProvider } from "@sci/intelligence";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { client, login, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
let base = "";
let admin = "";
let tenant = "";
let other = "";
let otherTenant = "";
let customerId = "";

class Scripted implements TranscriptionProvider {
  name = "s";
  constructor(private lines: { channel: number; text: string }[]) {}
  async open(_o: unknown, ev: TranscriptionEvents) {
    let i = 0;
    return {
      sendAudio: () => {
        const l = this.lines[i++];
        if (l)
          ev.onResult({
            channel: l.channel,
            text: l.text,
            isFinal: true,
            startMs: i * 5000,
            endMs: i * 5000 + 4000,
            confidence: 0.9,
          });
      },
      finalize: () => {},
      close: async () => {},
    };
  }
}
const until = async (fn: () => boolean | Promise<boolean>, ms = 15000) => {
  const t = Date.now();
  while (!(await fn())) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function runMeeting(lines: { channel: number; text: string }[], cust: string | null) {
  const a = client(ctx, admin, tenant);
  ctx.transcription.provider = new Scripted(lines);
  const m = (
    await a.post("/meetings", {
      platform: "google_meet",
      meetingType: "follow_up",
      ...(cust ? { customerId: cust } : {}),
    })
  ).json();
  await a.post(`/meetings/${m.id}/consent`, { method: "verbal_announcement", confirmed: true });
  const t = (await a.post(`/meetings/${m.id}/stream-ticket`)).json();
  const ws = new WebSocket(`${base}${t.wsPath}?ticket=${t.ticket}`);
  const msgs: { type: string }[] = [];
  ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
  await until(() => msgs.some((x) => x.type === "ready")).catch((e) => {
    throw new Error(`sem ready: ${JSON.stringify(msgs)}`, { cause: e });
  });
  for (let i = 0; i < lines.length; i++) ws.send(Buffer.alloc(3200));
  await until(() => msgs.filter((x) => x.type === "segment").length === lines.length).catch((e) => {
    throw new Error(`segmentos: ${JSON.stringify(msgs.map((x) => x.type))}`, { cause: e });
  });
  ws.close();
  const segs = (await a.get(`/meetings/${m.id}/transcript`)).json() as { id: number; text: string }[];
  return { id: m.id as string, seg: (frag: string) => segs.find((s) => s.text.includes(frag))!.id };
}

beforeAll(async () => {
  ctx = await setup();
  await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  base = `ws://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
  tenant = (
    await s.post("/platform/tenants", {
      name: "CI Co",
      slug: "ci-co",
      admin: { name: "Ana", email: "ana@ci.com", password: "senha-ana-123456" },
    })
  ).json().id;
  otherTenant = (
    await s.post("/platform/tenants", {
      name: "Outra",
      slug: "outra-ci",
      admin: { name: "Bia", email: "bia@ci2.com", password: "senha-bia-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@ci.com", "senha-ana-123456");
  other = await login(ctx, "bia@ci2.com", "senha-bia-123456");
  customerId = (
    await client(ctx, admin, tenant).post("/customers", { name: "ACME", mrrCents: 1_200_000 })
  ).json().id;
});
afterAll(async () => ctx?.close());

const LINES = [
  { channel: 0, text: "Como está o uso da plataforma?" },
  { channel: 1, text: "Estamos usando pouco, a equipe não se adaptou e isso nos frustra." },
  { channel: 1, text: "Sinceramente estamos pensando em cancelar se nada mudar." },
  { channel: 1, text: "Por outro lado, a filial do Sul quer começar a usar." },
  { channel: 0, text: "Vou agendar um treinamento para a equipe na próxima semana." },
];

describe("Modo Análise ponta a ponta", () => {
  let meetingId = "";

  it("encerrar dispara a análise: indicadores com evidência, Health, Churn, Expansão e Plano de Ação", async () => {
    const r = await runMeeting(LINES, customerId);
    meetingId = r.id;
    ctx.ai.output = {
      summary: "Cliente com baixa adoção e intenção de cancelar; nova área interessada.",
      diagnosis: "Risco relevante por falta de adaptação da equipe.",
      indicators: [
        {
          indicator: "adoption",
          level: 1,
          confidence: 0.8,
          rationale: "Uso baixo declarado.",
          evidence: [r.seg("usando pouco")],
        },
        {
          indicator: "satisfaction",
          level: 1,
          confidence: 0.7,
          rationale: "Frustração.",
          evidence: [r.seg("frustra")],
        },
        {
          indicator: "engagement",
          level: 2,
          confidence: 0.6,
          rationale: "Participa da conversa.",
          evidence: [r.seg("filial")],
        },
        {
          indicator: "churn_risk",
          level: 4,
          confidence: 0.8,
          rationale: "Intenção explícita.",
          evidence: [r.seg("cancelar")],
        },
        { indicator: "trust", level: 2, confidence: 0.4, rationale: "Inventado", evidence: [] },
      ],
      risks: [
        {
          factorKey: "cancellation_intent",
          severity: "critical",
          evidence: [r.seg("cancelar")],
          recommendation: "Reunião executiva de recuperação",
          nextAction: "Agendar com o decisor",
        },
        { factorKey: "low_adoption", severity: "medium", evidence: [r.seg("usando pouco")] },
      ],
      opportunities: [{ type: "new_area", need: "Filial do Sul quer usar", evidence: [r.seg("filial")] }],
      actions: [
        {
          title: "Agendar treinamento da equipe",
          responsibleParty: "internal",
          dueInDays: 7,
          priority: "high",
          evidence: [r.seg("treinamento")],
        },
        {
          title: "Propor upsell para a filial",
          responsibleParty: "internal",
          dueInDays: 10,
          priority: "low",
          evidence: [r.seg("filial")],
        },
      ],
    };
    const end = (await client(ctx, admin, tenant).post(`/meetings/${meetingId}/end`)).json();
    expect(end.status).toBe("analyzed");

    const an = (await client(ctx, admin, tenant).get(`/meetings/${meetingId}/analysis`)).json();
    expect(an).toMatchObject({
      status: "completed",
      mode: "full",
      version: 1,
      model: "fake-model",
      skillVersion: "1.0.0",
    });
    const adoption = an.indicators.find((i: { indicator: string }) => i.indicator === "adoption");
    expect(adoption).toMatchObject({
      score: 25,
      evidence: [
        { text: "Estamos usando pouco, a equipe não se adaptou e isso nos frustra.", speaker: "customer" },
      ],
    });
    expect(an.indicators.find((i: { indicator: string }) => i.indicator === "trust").score).toBeNull();
    expect(an.indicators.find((i: { indicator: string }) => i.indicator === "churn_risk").score).toBe(100);

    const health = (await client(ctx, admin, tenant).get(`/customers/${customerId}/health`)).json();
    expect(health.current.classification).toBe("high_risk"); // trava por sinal crítico
    expect(health.current.overrides.join(" ")).toContain("sinal crítico");
    expect(health.current.factors[0]).toHaveProperty("impact");

    const churn = (await client(ctx, admin, tenant).get("/churn-signals")).json();
    expect(churn.map((c: { factorKey: string; severity: string }) => [c.factorKey, c.severity])).toEqual([
      ["cancellation_intent", "critical"],
      ["low_adoption", "medium"],
    ]);
    expect(churn[0].revenueAtRiskCents).toBe(1_200_000);
    expect(churn[1].revenueAtRiskCents).toBeNull();

    const opps = (await client(ctx, admin, tenant).get("/opportunities")).json();
    expect(opps[0]).toMatchObject({ type: "new_area", potentialCents: null, customerName: "ACME" });
    expect(opps[0].nextAction).toContain("após tratar os riscos");

    const tasks = (await client(ctx, admin, tenant).get(`/tasks?meetingId=${meetingId}`)).json();
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(["Agendar treinamento da equipe"]); // sem upsell com risco aberto
    expect(tasks[0].ownerName).toBe("Ana");
    expect(tasks[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("dashboard reflete números reais", async () => {
    const d = (await client(ctx, admin, tenant).get("/dashboard/summary")).json();
    expect(d).toMatchObject({
      activeCustomers: 1,
      highRisk: 1,
      healthy: 0,
      analyzedMeetings: 1,
      revenueAtRiskCents: 1_200_000,
      openExpansionOpportunities: 1,
      pendingActionTasks: 1,
      overdueActionTasks: 0,
    });
    const rows = (await client(ctx, admin, tenant).get("/health/customers")).json();
    expect(rows[0]).toMatchObject({ customerName: "ACME", classification: "high_risk", openRisks: 2 });
  });

  it("tarefa vencida aparece como atrasada; conclusão registra data", async () => {
    const a = client(ctx, admin, tenant);
    const t = (
      await a.post("/tasks", { title: "Enviar material", customerId, dueDate: "2020-01-01" })
    ).json();
    expect(t.status).toBe("overdue");
    expect((await a.get("/tasks?status=overdue")).json().map((x: { id: string }) => x.id)).toContain(t.id);
    const done = (await a.patch(`/tasks/${t.id}`, { status: "done" })).json();
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeTruthy();
  });

  it("valor de oportunidade só por informação humana", async () => {
    const a = client(ctx, admin, tenant);
    const opp = (await a.get("/opportunities")).json()[0];
    const r = (
      await a.patch(`/opportunities/${opp.id}`, { potentialCents: 500000, status: "qualified" })
    ).json();
    expect(r).toMatchObject({ potentialCents: 500000, status: "qualified" });
  });

  it("recorrência: nova reunião com o mesmo fator incrementa e reanálise não duplica tarefas", async () => {
    const r = await runMeeting(
      [{ channel: 1, text: "A equipe continua usando pouco o sistema." }],
      customerId,
    );
    ctx.ai.output = {
      indicators: [],
      risks: [{ factorKey: "low_adoption", evidence: [r.seg("usando pouco")] }],
      opportunities: [{ type: "new_area", need: "Filial voltou a pedir", evidence: [r.seg("usando pouco")] }],
      actions: [{ title: "Acompanhar adoção", evidence: [r.seg("usando pouco")] }],
    };
    await client(ctx, admin, tenant).post(`/meetings/${r.id}/end`);
    let low = (await client(ctx, admin, tenant).get("/churn-signals"))
      .json()
      .find((c: { factorKey: string }) => c.factorKey === "low_adoption");
    expect(low).toMatchObject({ recurrence: 2, severity: "high" });
    expect(
      (await client(ctx, admin, tenant).get(`/meetings/${r.id}/analysis`)).json().risks[0].factorKey,
    ).toBe("low_adoption");
    // mesma oportunidade aberta (cliente + tipo) não é duplicada; a evidência é reforçada
    const opps = (await client(ctx, admin, tenant).get(`/opportunities?customerId=${customerId}`)).json();
    expect(opps.filter((o: { type: string }) => o.type === "new_area")).toHaveLength(1);
    expect(opps[0].evidence.length).toBeGreaterThan(1);
    // reanálise da mesma reunião
    expect((await client(ctx, admin, tenant).post(`/meetings/${r.id}/analyze`)).statusCode).toBe(202);
    low = (await client(ctx, admin, tenant).get("/churn-signals"))
      .json()
      .find((c: { factorKey: string }) => c.factorKey === "low_adoption");
    expect(low.recurrence).toBe(2);
    const tasks = (await client(ctx, admin, tenant).get(`/tasks?meetingId=${r.id}`)).json();
    expect(tasks.filter((t: { status: string }) => t.status !== "cancelled")).toHaveLength(1);
    expect((await client(ctx, admin, tenant).get(`/meetings/${r.id}/analysis`)).json().version).toBe(2);
  });

  it("sem DeepSeek: análise básica, sem indicadores nem Health inventados", async () => {
    const saved = ctx.ai.reasoning;
    ctx.ai.reasoning = null;
    const c2 = (await client(ctx, admin, tenant).post("/customers", { name: "Beta" })).json().id;
    const r = await runMeeting([{ channel: 1, text: "Estamos usando pouco, a equipe não se adaptou." }], c2);
    await new Promise((res) => setTimeout(res, 1500)); // sinais ao vivo
    await client(ctx, admin, tenant).post(`/meetings/${r.id}/end`);
    const an = (await client(ctx, admin, tenant).get(`/meetings/${r.id}/analysis`)).json();
    expect(an.mode).toBe("basic");
    expect(an.indicators.every((i: { score: number | null }) => i.score === null)).toBe(true);
    const h = (await client(ctx, admin, tenant).get(`/customers/${c2}/health`)).json();
    expect(h.current.score).toBeNull();
    ctx.ai.reasoning = saved;
  });

  it("isolamento: outro tenant não vê análises, sinais, oportunidades nem tarefas", async () => {
    const o = client(ctx, other, otherTenant);
    expect((await o.get(`/meetings/${meetingId}/analysis`)).json()).toBeNull();
    expect((await o.get("/churn-signals")).json()).toEqual([]);
    expect((await o.get("/opportunities")).json()).toEqual([]);
    expect((await o.get("/tasks")).json()).toEqual([]);
    expect((await o.get(`/customers/${customerId}/health`)).statusCode).toBe(404);
    const owner = new pg.Client({ connectionString: ctx.db.ownerUrl });
    await owner.connect();
    const { rows } = await owner.query("SELECT count(*)::int AS n FROM churn_signals");
    await owner.end();
    expect(rows[0].n).toBe(0); // owner também está sujeito a RLS forçado
  });

  it("pesos de Health configuráveis com permissão", async () => {
    const a = client(ctx, admin, tenant);
    const s = (await a.get("/settings/health")).json();
    expect((await a.put("/settings/health", { ...s, healthyMin: 80 })).json().healthyMin).toBe(80);
    expect((await a.put("/settings/health", { ...s, attentionMin: 90, healthyMin: 80 })).statusCode).toBe(
      400,
    );
  });
});
