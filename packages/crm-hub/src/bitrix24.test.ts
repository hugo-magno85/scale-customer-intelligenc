import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./http.js";
import { bitrixFactory, createBitrixClient, parseBitrixWebhook } from "./index.js";

const SECRET = "https://acme.bitrix24.com.br/rest/7/abc123secretcode/";
const hook = parseBitrixWebhook(SECRET, "acme.bitrix24.com.br");

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
/** fetch simulado: responde por método REST na ordem das chamadas. */
function fakeFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const method = url.slice(hook.base.length);
    calls.push({ method, body: JSON.parse(String(init.body)) });
    const r = routes[method];
    const rep = Array.isArray(r) ? r.shift()! : r;
    if (!rep) throw new Error(`rota não simulada: ${method}`);
    return new Response(JSON.stringify(rep.body), {
      status: rep.status ?? 200,
      headers: { "content-type": "application/json", ...rep.headers },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const client = (routes: Record<string, Reply | Reply[]>) => {
  const f = fakeFetch(routes);
  return {
    ...f,
    c: createBitrixClient(hook, { fetch: f.fn, sleep: async () => {}, limiter: new RateLimiter(1000, 1000) }),
  };
};

describe("Bitrix24 — URL do webhook", () => {
  it("aceita o formato oficial e extrai o usuário", () => {
    expect(hook).toEqual({
      host: "acme.bitrix24.com.br",
      userId: "7",
      base: "https://acme.bitrix24.com.br/rest/7/abc123secretcode/",
    });
    expect(
      parseBitrixWebhook("https://ACME.bitrix24.com/rest/1/xyz789", "https://acme.bitrix24.com/").host,
    ).toBe("acme.bitrix24.com");
  });

  it("recusa outros endereços (evita uso da API como proxy) e não vaza o código", () => {
    const bad = [
      "http://acme.bitrix24.com.br/rest/7/abc123secretcode/",
      "https://acme.bitrix24.com.br.evil.com/rest/7/abc123secretcode/",
      "https://evil.com/rest/7/abc123secretcode/",
      "https://acme.bitrix24.com.br/rest/7/abc123secretcode/crm.deal.get",
      "https://acme.bitrix24.com.br/rest/7/abc123secretcode/?x=1",
      "https://user:pw@acme.bitrix24.com.br/rest/7/abc123secretcode/",
      "https://acme.bitrix24.com.br:8443/rest/7/abc123secretcode/",
      "não é url",
    ];
    for (const s of bad) {
      expect(() => parseBitrixWebhook(s, "acme.bitrix24.com.br")).toThrow();
      try {
        parseBitrixWebhook(s, "acme.bitrix24.com.br");
      } catch (e) {
        expect((e as Error).message).not.toContain("abc123secretcode");
      }
    }
    expect(() => parseBitrixWebhook(SECRET, "outra.bitrix24.com.br")).toThrow(/outro portal/);
    expect(() =>
      bitrixFactory({ externalAccountId: "acme.bitrix24.com.br", secret: SECRET, authType: "oauth" }),
    ).toThrow(/webhook/);
  });
});

describe("Bitrix24 — chamadas", () => {
  it("valida a conexão pelas permissões do webhook", async () => {
    expect(
      await client({ scope: { body: { result: ["crm", "task", "user"] } } }).c.validateConnection(),
    ).toEqual({
      accountName: "acme.bitrix24.com.br",
    });
    await expect(client({ scope: { body: { result: ["task"] } } }).c.validateConnection()).rejects.toThrow(
      /permissão CRM/,
    );
  });

  it("negócio: título, etapa, empresa, contato e responsável", async () => {
    const { c, calls } = client({
      "crm.deal.get": {
        body: {
          result: {
            ID: "10",
            TITLE: "Renovação 2027",
            STAGE_ID: "C2:NEW",
            COMPANY_ID: "9",
            CONTACT_ID: "84",
            ASSIGNED_BY_ID: "3",
          },
        },
      },
      "crm.company.get": { body: { result: { ID: "9", TITLE: "ACME Ltda" } } },
      "crm.contact.get": {
        body: {
          result: {
            ID: "84",
            NAME: "Ana",
            LAST_NAME: "Souza",
            EMAIL: [{ VALUE: "ana@acme.com", VALUE_TYPE: "WORK" }],
          },
        },
      },
      "user.get": { body: { result: [{ ID: "3", NAME: "Hugo", LAST_NAME: "M." }] } },
    });
    expect(await c.getRecord("deal", "10")).toEqual({
      deal: { id: "10", title: "Renovação 2027", stage: "C2:NEW" },
      company: { id: "9", name: "ACME Ltda" },
      contact: { id: "84", name: "Ana Souza", email: "ana@acme.com" },
      owner: { id: "3", name: "Hugo M." },
      recordUrl: "https://acme.bitrix24.com.br/crm/deal/details/10/",
    });
    expect(calls[0]).toEqual({ method: "crm.deal.get", body: { id: "10" } });
    expect(calls[3]!.body).toEqual({ filter: { ID: "3" }, select: ["ID", "NAME", "LAST_NAME"] });
  });

  it("sem empresa/contato e sem permissão de usuários: não inventa dados", async () => {
    const { c } = client({
      "crm.deal.get": {
        body: {
          result: {
            ID: "11",
            TITLE: "Deal",
            STAGE_ID: "NEW",
            COMPANY_ID: "0",
            CONTACT_ID: null,
            ASSIGNED_BY_ID: "5",
          },
        },
      },
      "user.get": { status: 401, body: { error: "insufficient_scope", error_description: "x" } },
    });
    const r = await c.getRecord("deal", "11");
    expect(r.company).toBeNull();
    expect(r.contact).toBeNull();
    expect(r.owner).toEqual({ id: "5", name: "Usuário 5" });
  });

  it("erros do Bitrix viram mensagens claras", async () => {
    await expect(
      client({
        "crm.deal.get": { status: 400, body: { error: "", error_description: "Not found" } },
      }).c.getRecord("deal", "99"),
    ).rejects.toThrow("Registro não encontrado no Bitrix24");
    await expect(
      client({
        "crm.deal.get": { status: 400, body: { error: "", error_description: "Access denied" } },
      }).c.getRecord("deal", "99"),
    ).rejects.toThrow(/permissão para acessar este registro/);
    await expect(
      client({
        scope: {
          status: 401,
          body: { error: "INVALID_CREDENTIALS", error_description: "Invalid request credentials" },
        },
      }).c.validateConnection(),
    ).rejects.toThrow(/não encontrado ou desativado/);
    await expect(client({}).c.getRecord("deal", "1; drop")).rejects.toThrow("ID do registro inválido");
  });

  it("limite de requisições: espera e tenta de novo", async () => {
    const { c, calls } = client({
      "crm.company.get": [
        { status: 503, body: { error: "QUERY_LIMIT_EXCEEDED", error_description: "Too many requests" } },
        { body: { result: { ID: "9", TITLE: "ACME" } } },
      ],
    });
    expect((await c.getRecord("company", "9")).company).toEqual({ id: "9", name: "ACME" });
    expect(calls.filter((x) => x.method === "crm.company.get")).toHaveLength(2);
  });

  it("escrita: comentário na timeline e tarefa vinculada ao negócio", async () => {
    const { c, calls } = client({
      "crm.timeline.comment.add": { body: { result: 999 } },
      "tasks.task.add": { body: { result: { task: { id: "3711" } } } },
    });
    expect(await c.publishNote("deal", "10", { title: "Resumo", body: "Texto" }, "k")).toEqual({
      externalNoteId: "999",
    });
    expect(calls[0]!.body).toEqual({
      fields: { ENTITY_ID: 10, ENTITY_TYPE: "deal", COMMENT: "Resumo\n\nTexto" },
    });
    expect(
      await c.createTask(
        "deal",
        "10",
        { title: "Treinar equipe", dueDate: "2026-12-10", ownerExternalId: null },
        "k",
      ),
    ).toEqual({ externalTaskId: "3711" });
    expect(calls[1]!.body).toEqual({
      fields: {
        TITLE: "Treinar equipe",
        RESPONSIBLE_ID: 7,
        DEADLINE: "2026-12-10T18:00:00",
        UF_CRM_TASK: ["D_10"],
      },
    });
  });
});
