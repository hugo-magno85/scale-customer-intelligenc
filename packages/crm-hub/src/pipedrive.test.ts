import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./http.js";
import {
  createPipedriveClient,
  credentialFormatError,
  normalizePipedriveAccount,
  pipedriveFactory,
} from "./index.js";

const TOKEN = "0123456789abcdef0123456789abcdef01234567";
type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

function fake(routes: Record<string, Reply | Reply[]>, account = "acme") {
  const calls: { key: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    calls.push({
      key,
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = routes[key];
    const rep = Array.isArray(r) ? r.shift() : r;
    if (!rep) throw new Error(`rota não simulada: ${key}`);
    return new Response(JSON.stringify(rep.body), {
      status: rep.status ?? 200,
      headers: { "content-type": "application/json", ...rep.headers },
    });
  });
  return {
    calls,
    c: createPipedriveClient(account, TOKEN, {
      fetch: fn as unknown as typeof fetch,
      sleep: async () => {},
      limiter: new RateLimiter(1000, 1000),
    }),
  };
}
const ok = (data: unknown): Reply => ({ body: { success: true, data } });

describe("Pipedrive — conexão", () => {
  it("normaliza a conta e valida o formato do token sem chamar a API", () => {
    expect(normalizePipedriveAccount("https://ACME.pipedrive.com/deal/1")).toBe("acme");
    expect(normalizePipedriveAccount("acme")).toBe("acme");
    expect(credentialFormatError("pipedrive", "api_token", "acme", TOKEN)).toBeNull();
    expect(credentialFormatError("pipedrive", "api_token", "acme", "token com espaço")).toMatch(/inválido/);
    expect(credentialFormatError("pipedrive", "oauth", "acme", TOKEN)).toMatch(/token de API/);
    expect(() => pipedriveFactory({ externalAccountId: "acme", secret: TOKEN, authType: "oauth" })).toThrow();
  });

  it("token só vai para api.pipedrive.com, no cabeçalho; confere a empresa", async () => {
    const { c, calls } = fake({
      "GET /v1/users/me": ok({ name: "Hugo", company_domain: "acme", company_name: "ACME" }),
    });
    expect(await c.validateConnection()).toEqual({ accountName: "ACME" });
    expect(calls[0]!.url).toBe("https://api.pipedrive.com/v1/users/me");
    expect(calls[0]!.headers["x-api-token"]).toBe(TOKEN);
    expect(calls[0]!.url).not.toContain(TOKEN);
    await expect(
      fake({ "GET /v1/users/me": ok({ name: "X", company_domain: "outra" }) }).c.validateConnection(),
    ).rejects.toThrow(/empresa "outra"/);
    await expect(
      fake({
        "GET /v1/users/me": { status: 401, body: { success: false, error: "unauthorized" } },
      }).c.validateConnection(),
    ).rejects.toThrow(/inválido ou revogado/);
  });
});

describe("Pipedrive — registros", () => {
  it("negócio com organização, pessoa e responsável", async () => {
    const { c } = fake({
      "GET /api/v2/deals/42": ok({
        id: 42,
        title: "Renovação",
        stage_id: 3,
        org_id: 9,
        person_id: 7,
        owner_id: 5,
      }),
      "GET /api/v2/organizations/9": ok({ id: 9, name: "ACME Ltda" }),
      "GET /api/v2/persons/7": ok({
        id: 7,
        name: "Ana Souza",
        emails: [
          { value: "ana@x.com", primary: false },
          { value: "ana@acme.com", primary: true },
        ],
      }),
      "GET /v1/users/5": ok({ id: 5, name: "Carla" }),
    });
    expect(await c.getRecord("deal", "42")).toEqual({
      deal: { id: "42", title: "Renovação", stage: "Etapa 3" },
      company: { id: "9", name: "ACME Ltda" },
      contact: { id: "7", name: "Ana Souza", email: "ana@acme.com" },
      owner: { id: "5", name: "Carla" },
      recordUrl: "https://acme.pipedrive.com/deal/42",
    });
  });

  it("lead por UUID, 404 e IDs inválidos", async () => {
    const lead = "adf21080-0e10-11eb-879b-05d71fb426ec";
    const { c } = fake({
      [`GET /v1/leads/${lead}`]: ok({
        id: lead,
        title: "Novo lead",
        person_id: null,
        organization_id: null,
        owner_id: null,
      }),
    });
    expect((await c.getRecord("lead", lead)).deal).toEqual({
      id: lead,
      title: "Lead: Novo lead",
      stage: null,
    });
    await expect(
      fake({
        "GET /api/v2/deals/1": { status: 404, body: { success: false, error: "Deal not found" } },
      }).c.getRecord("deal", "1"),
    ).rejects.toThrow("Registro não encontrado no Pipedrive");
    await expect(c.getRecord("deal", "../users")).rejects.toThrow("ID do registro inválido");
    await expect(c.getRecord("lead", "123")).rejects.toThrow("ID do registro inválido");
  });

  it("limite de requisições: espera e tenta de novo", async () => {
    const { c, calls } = fake({
      "GET /api/v2/organizations/9": [
        { status: 429, body: { success: false, error: "Rate limit" }, headers: { "retry-after": "1" } },
        ok({ id: 9, name: "ACME" }),
      ],
    });
    expect((await c.getRecord("company", "9")).company).toEqual({ id: "9", name: "ACME" });
    expect(calls).toHaveLength(2);
  });
});

describe("Pipedrive — envio", () => {
  it("nota em HTML seguro e atividade vinculada ao negócio", async () => {
    const { c, calls } = fake({
      "POST /v1/notes": ok({ id: 77 }),
      "POST /api/v2/activities": ok({ id: 88 }),
    });
    expect(await c.publishNote("deal", "42", { title: "Resumo <b>", body: "linha 1\nlinha 2" }, "k")).toEqual(
      {
        externalNoteId: "77",
      },
    );
    expect(calls[0]!.body).toEqual({
      content: "<b>Resumo &lt;b&gt;</b><br><br>linha 1<br>linha 2",
      deal_id: 42,
    });
    expect(
      await c.createTask(
        "deal",
        "42",
        { title: "Treinar equipe", description: "Detalhe", dueDate: "2026-12-10", ownerExternalId: "5" },
        "k",
      ),
    ).toEqual({ externalTaskId: "88" });
    expect(calls[1]!.body).toEqual({
      subject: "Treinar equipe",
      type: "task",
      deal_id: 42,
      due_date: "2026-12-10",
      owner_id: 5,
      note: "Detalhe",
    });
  });

  it("campos do negócio: reaproveita os existentes, cria os que faltam e grava", async () => {
    const { c, calls } = fake({
      "GET /api/v2/dealFields": ok([{ field_code: "abc111", field_name: "Customer Health (Scale) 0–10" }]),
      "POST /api/v2/dealFields": [ok({ field_code: "def222" }), ok({ field_code: "ghi333" })],
      "PATCH /api/v2/deals/42": ok({ id: 42 }),
    });
    const r = await c.updateSummaryFields!("deal", "42", {
      healthScore10: 6.8,
      riskLabel: "Alto",
      analyzedAt: "2026-11-27T12:00:00.000Z",
    });
    expect(r.warnings).toEqual([]);
    expect(r.fields).toHaveLength(3);
    expect(calls.filter((x) => x.key === "POST /api/v2/dealFields").map((x) => x.body)).toEqual([
      { field_name: "Risco de churn (Scale)", field_type: "varchar" },
      { field_name: "Última análise (Scale)", field_type: "date" },
    ]);
    expect(calls.find((x) => x.key === "PATCH /api/v2/deals/42")!.body).toEqual({
      custom_fields: { abc111: 6.8, def222: "Alto", ghi333: "2026-11-27" },
    });
  });

  it("sem permissão para criar campos: avisa sem falhar", async () => {
    const c = createPipedriveClient("beta", TOKEN, {
      fetch: (async (url: string, init: RequestInit) => {
        const key = `${init.method} ${new URL(url).pathname}`;
        if (key === "GET /api/v2/dealFields")
          return new Response(JSON.stringify({ success: true, data: [] }));
        return new Response(JSON.stringify({ success: false, error: "forbidden" }), { status: 403 });
      }) as typeof fetch,
      sleep: async () => {},
      limiter: new RateLimiter(1000, 1000),
    });
    const r = await c.updateSummaryFields!("deal", "1", {
      healthScore10: 5,
      riskLabel: null,
      analyzedAt: "2026-11-27T00:00:00Z",
    });
    expect(r.fields).toEqual([]);
    expect(r.warnings[0]).toMatch(/administrador/);
  });

  it("API v2 de campos indisponível na conta: usa a v1 para listar e criar", async () => {
    const { c, calls } = fake(
      {
        "GET /api/v2/dealFields": { status: 404, body: { success: false, error: "Not found" } },
        "GET /v1/dealFields": ok([{ key: "k_health", name: "Customer Health (Scale) 0–10" }]),
        "POST /api/v2/dealFields": [
          { status: 404, body: { success: false, error: "Not found" } },
          { status: 404, body: { success: false, error: "Not found" } },
        ],
        "POST /v1/dealFields": [ok({ key: "k_risk" }), ok({ key: "k_last" })],
        "PATCH /api/v2/deals/42": ok({ id: 42 }),
      },
      "gamma",
    );
    const r = await c.updateSummaryFields!("deal", "42", {
      healthScore10: 7.1,
      riskLabel: "Médio",
      analyzedAt: "2026-11-27T12:00:00.000Z",
    });
    expect(r).toEqual({
      fields: ["Customer Health (Scale) 0–10", "Risco de churn (Scale)", "Última análise (Scale)"],
      warnings: [],
    });
    expect(calls.filter((x) => x.key === "POST /v1/dealFields").map((x) => x.body)).toEqual([
      { name: "Risco de churn (Scale)", field_type: "varchar" },
      { name: "Última análise (Scale)", field_type: "date" },
    ]);
    expect(calls.find((x) => x.key === "PATCH /api/v2/deals/42")!.body).toEqual({
      custom_fields: { k_health: 7.1, k_risk: "Médio", k_last: "2026-11-27" },
    });
  });
});
