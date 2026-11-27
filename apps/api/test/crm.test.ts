import { randomBytes } from "node:crypto";
import { registerCrmClient } from "@sci/crm-hub";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, login, setup, type Ctx } from "./helpers.js";

process.env.SCI_ENCRYPTION_KEYS = `k1:${randomBytes(32).toString("base64")}`;
process.env.SCI_ENCRYPTION_ACTIVE_KEY = "k1";

let ctx: Ctx;
let admin = "";
let cs = "";
let tenant = "";
let other = "";
let otherTenant = "";
let meetingAdmin = "";
let meetingCs = "";

beforeAll(async () => {
  ctx = await setup();
  const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
  tenant = (
    await s.post("/platform/tenants", {
      name: "CRM Co",
      slug: "crm-co",
      admin: { name: "Ana", email: "ana@crm.com", password: "senha-ana-123456" },
    })
  ).json().id;
  otherTenant = (
    await s.post("/platform/tenants", {
      name: "Outra",
      slug: "outra-crm",
      admin: { name: "Bia", email: "bia@crm2.com", password: "senha-bia-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@crm.com", "senha-ana-123456");
  other = await login(ctx, "bia@crm2.com", "senha-bia-123456");
  const a = client(ctx, admin, tenant);
  const roles = (await a.get("/roles")).json();
  await a.post("/members", {
    name: "Caio CS",
    email: "caio@crm.com",
    password: "senha-caio-12345",
    roleId: roles.find((r: { systemKey: string }) => r.systemKey === "cs").id,
  });
  cs = await login(ctx, "caio@crm.com", "senha-caio-12345");
  meetingAdmin = (await a.post("/meetings", { platform: "google_meet" })).json().id;
  meetingCs = (await client(ctx, cs, tenant).post("/meetings", { platform: "zoom" })).json().id;
});
afterAll(async () => ctx?.close());

describe("conexões de CRM", () => {
  it("lista os 4 CRMs: Bitrix24 e Pipedrive em homologação, os demais aguardando", async () => {
    const p = (await client(ctx, admin, tenant).get("/crm/providers")).json();
    expect(p.map((x: { key: string }) => x.key)).toEqual(["bitrix24", "pipedrive", "rdstation", "zoho"]);
    expect(p.map((x: { status: string }) => x.status)).toEqual([
      "homologation",
      "homologation",
      "awaiting_credentials",
      "awaiting_credentials",
    ]);
  });

  it("guarda a credencial cifrada e nunca a devolve", async () => {
    const r = await client(ctx, admin, tenant).post("/crm/connections", {
      provider: "pipedrive",
      label: "Pipedrive principal",
      externalAccountId: "acme",
      authType: "api_token",
      secret: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ hasCredentials: true, status: "pending" });
    expect(r.body).not.toContain("0123456789abcdef0123");
    const c = new pg.Client({ connectionString: ctx.db.ownerUrl });
    await c.connect();
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    const row = (await c.query("SELECT encrypted_credentials FROM crm_connections")).rows[0];
    const auditRows = (
      await c.query("SELECT metadata::text AS m FROM audit_logs WHERE action = 'crm.connection.created'")
    ).rows;
    await c.query("COMMIT");
    await c.end();
    expect(row.encrypted_credentials).toMatch(/^v1:k1:/);
    expect(row.encrypted_credentials).not.toContain("0123456789abcdef0123");
    expect(auditRows[0].m).not.toContain("0123456789abcdef0123");
  });

  it("Bitrix24: só aceita a URL do webhook de entrada do próprio portal", async () => {
    const a = client(ctx, admin, tenant);
    const base = {
      provider: "bitrix24",
      label: "Bitrix",
      externalAccountId: "acme.bitrix24.com.br",
      authType: "webhook",
    };
    for (const secret of [
      "https://evil.example.com/rest/1/abcdef123456/",
      "https://outra.bitrix24.com.br/rest/1/abcdef123456/",
      "http://acme.bitrix24.com.br/rest/1/abcdef123456/",
      "abcdef123456",
    ]) {
      const r = await a.post("/crm/connections", { ...base, secret });
      expect(r.statusCode).toBe(400);
      expect(r.body).not.toContain("abcdef123456");
    }
    expect(
      (await a.post("/crm/connections", { ...base, authType: "oauth", secret: "x".repeat(20) })).statusCode,
    ).toBe(400);
  });

  it("validar conexão sem integração homologada é recusado com explicação", async () => {
    const z = (
      await client(ctx, admin, tenant).post("/crm/connections", {
        provider: "rdstation",
        label: "RD validação",
        externalAccountId: "rd-validacao",
        authType: "api_token",
        secret: "rd-token-12345678",
      })
    ).json();
    const r = await client(ctx, admin, tenant).post(`/crm/connections/${z.id}/validate`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toContain("homologada");
  });

  it("CS não gerencia conexões; outro tenant não vê", async () => {
    expect(
      (
        await client(ctx, cs, tenant).post("/crm/connections", {
          provider: "zoho",
          label: "Zoho",
          externalAccountId: "org1",
          authType: "oauth",
        })
      ).statusCode,
    ).toBe(403);
    expect((await client(ctx, other, otherTenant).get("/crm/connections")).json()).toEqual([]);
  });
});

describe("vínculo manual da reunião ao registro do CRM", () => {
  it("valida o formato e vincula por URL (pendente de validação no CRM)", async () => {
    const a = client(ctx, admin, tenant);
    expect(
      (
        await a.post(`/meetings/${meetingAdmin}/crm-link`, {
          provider: "pipedrive",
          reference: "https://acme.bitrix24.com/crm/deal/details/1/",
        })
      ).statusCode,
    ).toBe(400);
    const r = await a.post(`/meetings/${meetingAdmin}/crm-link`, {
      provider: "pipedrive",
      reference: "https://acme.pipedrive.com/deal/981",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()[0]).toMatchObject({
      provider: "pipedrive",
      entityType: "deal",
      externalRecordId: "981",
      recordUrl: "https://acme.pipedrive.com/deal/981",
      origin: "manual",
      validationStatus: "pending",
      active: true,
      userName: "Ana",
    });
    expect(r.json()[0].connectionId).toBeTruthy();
  });

  it("trocar vínculo exige permissão e preserva histórico", async () => {
    const c = client(ctx, cs, tenant);
    expect(
      (
        await c.post(`/meetings/${meetingCs}/crm-link`, {
          provider: "rdstation",
          reference: "64b1f0c2a9e3d4001a2b3c4d",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await c.post(`/meetings/${meetingCs}/crm-link`, {
          provider: "rdstation",
          reference: "64b1f0c2a9e3d4001a2b3c4e",
        })
      ).statusCode,
    ).toBe(403);
    const a = client(ctx, admin, tenant);
    const h = (
      await a.post(`/meetings/${meetingCs}/crm-link`, { provider: "zoho", reference: "5725767000001234567" })
    ).json();
    expect(h.map((l: { active: boolean; provider: string }) => [l.provider, l.active])).toEqual([
      ["rdstation", false],
      ["zoho", true],
    ]);
    expect(h[0].replacedAt).toBeTruthy();
    expect((await a.del(`/meetings/${meetingCs}/crm-link`)).statusCode).toBe(204);
    expect(
      (await a.get(`/meetings/${meetingCs}/crm-links`)).json().every((l: { active: boolean }) => !l.active),
    ).toBe(true);
  });

  it("outro tenant não vê nem altera vínculos", async () => {
    const o = client(ctx, other, otherTenant);
    expect((await o.get(`/meetings/${meetingAdmin}/crm-links`)).statusCode).toBe(404);
    expect(
      (await o.post(`/meetings/${meetingAdmin}/crm-link`, { provider: "pipedrive", reference: "1" }))
        .statusCode,
    ).toBe(404);
  });

  it("com integração homologada: valida a conexão e consulta o registro", async () => {
    registerCrmClient("pipedrive", ({ secret }) => ({
      validateConnection: async () => {
        if (secret !== "0123456789abcdef0123456789abcdef01234567") throw new Error("credenciais recusadas");
        return { accountName: "ACME" };
      },
      getRecord: async (_e, id) => ({
        company: { id: "9", name: "ACME Ltda" },
        deal: { id, title: "Renovação 2027", stage: "Negociação" },
        contact: { id: "5", name: "Maria", email: null },
        owner: { id: "1", name: "Carla" },
        recordUrl: null,
      }),
      publishNote: async () => ({ externalNoteId: "n1" }),
      createTask: async () => ({ externalTaskId: "t1" }),
    }));
    const a = client(ctx, admin, tenant);
    const conns = (await a.get("/crm/connections")).json();
    expect((await a.post(`/crm/connections/${conns[0].id}/validate`)).json().status).toBe("active");
    const links = (
      await a.post(`/meetings/${meetingAdmin}/crm-link`, { provider: "pipedrive", reference: "982" })
    ).json();
    expect(links.at(-1)).toMatchObject({
      validationStatus: "validated",
      snapshot: {
        company: { name: "ACME Ltda" },
        deal: { title: "Renovação 2027" },
        owner: { name: "Carla" },
      },
    });
  });
});
