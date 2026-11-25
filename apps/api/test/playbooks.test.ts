import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, login, setup, upload, type Ctx } from "./helpers.js";

let ctx: Ctx;
let admin = "";
let tenant = "";
let csUser = "";
let otherAdmin = "";
let otherTenant = "";

const interpreted = {
  summary: "Playbook de acompanhamento mensal.",
  objectives: ["Garantir adoção"],
  stages: [{ key: "abertura", name: "Abertura", objective: "Contextualizar" }],
  questions: [
    {
      key: "adocao",
      text: "Quais funcionalidades a equipe mais usa?",
      type: "adoption",
      indicator: "adoption",
      stageKey: "abertura",
      weight: 3,
      required: true,
    },
    {
      key: "valor",
      text: "Que resultado vocês perceberam",
      type: "value_perception",
      indicator: "value_perception",
    },
  ],
  criteria: [
    {
      key: "uso",
      name: "Uso semanal",
      description: "Equipe usa toda semana",
      indicator: "adoption",
      weight: 2,
    },
  ],
  triggers: [
    {
      when: "cliente cita concorrente",
      then: "Investigar critérios",
      signal: "risk",
      relatedQuestionKeys: ["valor"],
    },
  ],
};

beforeAll(async () => {
  ctx = await setup();
  const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
  tenant = (
    await s.post("/platform/tenants", {
      name: "Playbook Co",
      slug: "playbook-co",
      admin: { name: "Ana Admin", email: "ana@pb.com", password: "senha-ana-123456" },
    })
  ).json().id;
  otherTenant = (
    await s.post("/platform/tenants", {
      name: "Outra Co",
      slug: "outra-co",
      admin: { name: "Bia Admin", email: "bia@outra.com", password: "senha-bia-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@pb.com", "senha-ana-123456");
  otherAdmin = await login(ctx, "bia@outra.com", "senha-bia-123456");
  const roles = (await client(ctx, admin, tenant).get("/roles")).json();
  const cs = roles.find((r: { systemKey: string }) => r.systemKey === "cs");
  await client(ctx, admin, tenant).post("/members", {
    name: "Caio CS",
    email: "caio@pb.com",
    password: "senha-caio-12345",
    roleId: cs.id,
  });
  csUser = await login(ctx, "caio@pb.com", "senha-caio-12345");
});
afterAll(async () => ctx?.close());

describe("Playbook Intelligence — fluxo completo", () => {
  let playbookId = "";
  let v1 = "";

  it("cria playbook", async () => {
    const r = await client(ctx, admin, tenant).post("/playbooks", {
      name: "Acompanhamento mensal",
      meetingType: "follow_up",
      segment: "SaaS",
    });
    expect(r.statusCode).toBe(201);
    playbookId = r.json().id;
    expect(r.json()).toMatchObject({ active: true, publishedVersionId: null, latestVersionStatus: null });
    expect(
      (
        await client(ctx, admin, tenant).post("/playbooks", {
          name: "Acompanhamento mensal",
          meetingType: "other",
        })
      ).statusCode,
    ).toBe(409);
  });

  it("upload → extração → interpretação → em revisão", async () => {
    ctx.ai.output = interpreted;
    const r = await upload(ctx, admin, tenant, `/playbooks/${playbookId}/versions/upload`, [
      { name: "roteiro.md", content: "# Acompanhamento\n\nPerguntar sobre adoção e valor." },
      { name: "notas.txt", content: "Gatilho: concorrente." },
    ]);
    expect(r.statusCode, r.body).toBe(202);
    v1 = r.json().id;
    const v = (await client(ctx, admin, tenant).get(`/playbook-versions/${v1}`)).json();
    expect(v.status).toBe("in_review");
    expect(v.number).toBe(1);
    expect(v.skillVersion).toBe("1.0.0");
    expect(v.interpretationModel).toBe("fake-model");
    expect(v.documents).toHaveLength(2);
    expect(v.documents[0].extractedChars).toBeGreaterThan(0);
    expect(v.structure.questions[1].text).toBe("Que resultado vocês perceberam?");
    expect(v.structure.triggers[0].relatedQuestionKeys).toEqual(["valor"]);
  });

  it("revisão: edição valida a estrutura", async () => {
    const a = client(ctx, admin, tenant);
    const v = (await a.get(`/playbook-versions/${v1}`)).json();
    const bad = { ...v.structure, questions: [...v.structure.questions, { ...v.structure.questions[0] }] };
    expect((await a.put(`/playbook-versions/${v1}/structure`, { structure: bad })).statusCode).toBe(400);
    const edited = { ...v.structure, guidelines: ["Nunca falar de preço na abertura"] };
    const r = await a.put(`/playbook-versions/${v1}/structure`, { structure: edited });
    expect(r.statusCode).toBe(200);
    expect(r.json().structure.guidelines).toEqual(["Nunca falar de preço na abertura"]);
  });

  it("CS não aprova; administrador aprova e publica", async () => {
    expect((await client(ctx, csUser, tenant).post(`/playbook-versions/${v1}/approve`)).statusCode).toBe(403);
    const a = client(ctx, admin, tenant);
    expect((await a.post(`/playbook-versions/${v1}/publish`)).statusCode).toBe(409);
    const ap = await a.post(`/playbook-versions/${v1}/approve`);
    expect(ap.json()).toMatchObject({ status: "approved" });
    expect(ap.json().approvedBy).toBeTruthy();
    const pub = await a.post(`/playbook-versions/${v1}/publish`);
    expect(pub.json().status).toBe("published");
    expect((await a.get(`/playbooks/${playbookId}`)).json()).toMatchObject({
      publishedVersionId: v1,
      publishedVersionNumber: 1,
    });
  });

  it("versão publicada não pode ser editada", async () => {
    const a = client(ctx, admin, tenant);
    const v = (await a.get(`/playbook-versions/${v1}`)).json();
    expect((await a.put(`/playbook-versions/${v1}/structure`, { structure: v.structure })).statusCode).toBe(
      409,
    );
  });

  it("perguntas da versão publicada ficam normalizadas com id estável", async () => {
    const c = new pg.Client({ connectionString: ctx.db.ownerUrl });
    await c.connect();
    await c.query("SELECT set_config('app.tenant_id', $1, false)", [tenant]);
    const q = await c.query(
      "SELECT key, position, weight::float AS weight FROM playbook_questions WHERE version_id = $1 ORDER BY position",
      [v1],
    );
    await c.end();
    expect(q.rows).toEqual([
      { key: "adocao", position: 0, weight: 3 },
      { key: "valor", position: 1, weight: 1 },
    ]);
  });

  it("nova versão (clone) → publicação arquiva a anterior", async () => {
    const a = client(ctx, admin, tenant);
    const v2 = (await a.post(`/playbook-versions/${v1}/clone`)).json();
    expect(v2).toMatchObject({ number: 2, status: "draft" });
    expect((await a.post(`/playbook-versions/${v2.id}/submit`)).json().status).toBe("in_review");
    await a.post(`/playbook-versions/${v2.id}/approve`);
    await a.post(`/playbook-versions/${v2.id}/publish`);
    expect((await a.get(`/playbook-versions/${v1}`)).json().status).toBe("archived");
    const list = (await a.get(`/playbooks/${playbookId}/versions`)).json();
    expect(list.map((v: { number: number; status: string }) => [v.number, v.status])).toEqual([
      [2, "published"],
      [1, "archived"],
    ]);
  });

  it("cadastro manual cria rascunho", async () => {
    const a = client(ctx, admin, tenant);
    const r = await a.post(`/playbooks/${playbookId}/versions/manual`, {
      structure: {
        questions: [
          { key: "q1", text: "Como está o projeto?", type: "diagnosis", purpose: "Abrir conversa" },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "draft", source: "manual", number: 3 });
  });

  it("desativação do playbook", async () => {
    const r = await client(ctx, admin, tenant).patch(`/playbooks/${playbookId}`, { active: false });
    expect(r.json().active).toBe(false);
  });
});

describe("falhas e segurança", () => {
  let pid = "";
  beforeAll(async () => {
    pid = (
      await client(ctx, admin, tenant).post("/playbooks", { name: "Retenção", meetingType: "retention" })
    ).json().id;
  });

  it("rejeita formato não suportado e conteúdo disfarçado", async () => {
    const r1 = await upload(ctx, admin, tenant, `/playbooks/${pid}/versions/upload`, [
      { name: "a.exe", content: "MZ" },
    ]);
    expect(r1.statusCode).toBe(400);
    const r2 = await upload(ctx, admin, tenant, `/playbooks/${pid}/versions/upload`, [
      { name: "a.pdf", content: "não é pdf" },
    ]);
    expect(r2.statusCode).toBe(400);
  });

  it("sem provedor de IA: falha explicada, texto preservado e reprocessamento", async () => {
    const saved = ctx.ai.reasoning;
    ctx.ai.reasoning = null;
    const r = await upload(ctx, admin, tenant, `/playbooks/${pid}/versions/upload`, [
      { name: "r.txt", content: "Perguntar sobre renovação." },
    ]);
    const v = r.json();
    expect(v.status).toBe("failed");
    expect(v.processingError).toContain("DeepSeek não está configurado");
    expect(v.documents[0].extractedChars).toBeGreaterThan(0);
    ctx.ai.reasoning = saved;
    ctx.ai.output = {
      questions: [{ text: "Quais pontos vocês vão considerar na renovação?", type: "retention" }],
    };
    const re = await client(ctx, admin, tenant).post(`/playbook-versions/${v.id}/reprocess`);
    expect(re.json().status).toBe("in_review");
  });

  it("saída inválida do modelo vira falha, não dado corrompido", async () => {
    ctx.ai.output = { questions: "isto não é uma lista" };
    const r = await upload(ctx, admin, tenant, `/playbooks/${pid}/versions/upload`, [
      { name: "x.txt", content: "abc" },
    ]);
    expect(r.json().status).toBe("failed");
    expect(r.json().structure).toBeNull();
  });

  it("outro tenant não acessa playbooks nem versões", async () => {
    const o = client(ctx, otherAdmin, otherTenant);
    expect((await o.get("/playbooks")).json()).toEqual([]);
    expect((await o.get(`/playbooks/${pid}`)).statusCode).toBe(404);
    const versions = (await client(ctx, admin, tenant).get(`/playbooks/${pid}/versions`)).json();
    expect((await o.get(`/playbook-versions/${versions[0].id}`)).statusCode).toBe(404);
    expect((await o.post(`/playbook-versions/${versions[0].id}/approve`)).statusCode).toBe(404);
    expect(
      (
        await upload(ctx, otherAdmin, otherTenant, `/playbooks/${pid}/versions/upload`, [
          { name: "a.txt", content: "x" },
        ])
      ).statusCode,
    ).toBe(404);
  });
});

describe("configuração da skill de CS", () => {
  it("retorna manifesto com padrões e permite ajustar com permissão", async () => {
    const a = client(ctx, admin, tenant);
    const info = (await a.get("/skill")).json();
    expect(info.version).toBe("1.0.0");
    expect(info.settings.enabledQuestionTypes).toHaveLength(12);
    const put = await a.put("/skill/settings", {
      ...info.settings,
      formality: "formal",
      focusIndicators: ["adoption"],
    });
    expect(put.statusCode).toBe(200);
    expect((await a.get("/skill")).json().settings).toMatchObject({
      formality: "formal",
      focusIndicators: ["adoption"],
    });
    expect((await client(ctx, csUser, tenant).put("/skill/settings", info.settings)).statusCode).toBe(403);
    expect((await client(ctx, otherAdmin, otherTenant).get("/skill")).json().settings.formality).toBe(
      "neutral",
    );
  });
});
