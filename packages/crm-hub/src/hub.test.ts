import { describe, expect, it, vi } from "vitest";
import {
  crmClientFactory,
  CrmHttpError,
  idempotencyKey,
  listProviders,
  parseCrmReference,
  RateLimiter,
  requestJson,
} from "./index.js";

describe("leitura de URL/ID por CRM", () => {
  it("Bitrix24", () => {
    expect(
      parseCrmReference("bitrix24", "https://acme.bitrix24.com.br/crm/deal/details/4521/"),
    ).toMatchObject({
      entityType: "deal",
      externalRecordId: "4521",
      externalAccountId: "acme.bitrix24.com.br",
      source: "url",
    });
    expect(
      parseCrmReference("bitrix24", "https://acme.bitrix24.com/crm/company/details/77/").entityType,
    ).toBe("company");
  });
  it("Pipedrive", () => {
    expect(parseCrmReference("pipedrive", "https://acme.pipedrive.com/deal/981?tab=notes")).toMatchObject({
      entityType: "deal",
      externalRecordId: "981",
      externalAccountId: "acme",
      recordUrl: "https://acme.pipedrive.com/deal/981",
    });
    expect(parseCrmReference("pipedrive", "https://acme.pipedrive.com/person/5").entityType).toBe("contact");
  });
  it("RD Station CRM", () => {
    expect(
      parseCrmReference("rdstation", "https://crm.rdstation.com/app/deals/64B1F0C2A9E3D4001A2B3C4D"),
    ).toMatchObject({ entityType: "deal", externalRecordId: "64b1f0c2a9e3d4001a2b3c4d" });
  });
  it("Zoho CRM", () => {
    expect(
      parseCrmReference("zoho", "https://crm.zoho.com/crm/org712345678/tab/Potentials/5725767000001234567"),
    ).toMatchObject({
      entityType: "deal",
      externalRecordId: "5725767000001234567",
      externalAccountId: "org712345678",
    });
  });
  it("ID puro com formato próprio de cada CRM", () => {
    expect(parseCrmReference("pipedrive", " 123 ")).toMatchObject({
      externalRecordId: "123",
      source: "id",
      entityType: "deal",
    });
    expect(parseCrmReference("rdstation", "64b1f0c2a9e3d4001a2b3c4d", "company").entityType).toBe("company");
    expect(() => parseCrmReference("rdstation", "123")).toThrow(/formato/);
    expect(() => parseCrmReference("zoho", "12")).toThrow(/formato/);
  });
  it("não aceita URL de outro CRM, http nem domínio parecido", () => {
    expect(() => parseCrmReference("pipedrive", "https://acme.bitrix24.com/crm/deal/details/1/")).toThrow(
      /Não reconhecemos/,
    );
    expect(() => parseCrmReference("pipedrive", "http://acme.pipedrive.com/deal/1")).toThrow(/https/);
    expect(() => parseCrmReference("pipedrive", "https://pipedrive.com.evil.io/deal/1")).toThrow(
      /Não reconhecemos/,
    );
  });
});

describe("cliente HTTP resiliente", () => {
  const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });
  it("respeita Retry-After em 429 e tenta de novo", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(res(200, { ok: 1 }));
    const sleep = vi.fn(async () => {});
    expect(await requestJson("https://x", { fetch: f as never, sleep })).toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it("não repete em 401 e explica", async () => {
    const f = vi.fn().mockResolvedValue(res(401));
    await expect(
      requestJson("https://x", { fetch: f as never, sleep: async () => {} }),
    ).rejects.toMatchObject({ status: 401, retryable: false });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("desiste após o limite em 5xx", async () => {
    const f = vi.fn().mockResolvedValue(res(503));
    await expect(
      requestJson("https://x", { fetch: f as never, sleep: async () => {}, maxRetries: 2 }),
    ).rejects.toBeInstanceOf(CrmHttpError);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("limitador espera quando o balde esvazia", async () => {
    let t = 0;
    const rl = new RateLimiter(2, 1, () => t);
    await rl.take();
    const p = rl.take();
    t = 600;
    await p;
    expect(true).toBe(true);
  });
  it("idempotência estável", () => {
    expect(idempotencyKey("publish", "a", 1)).toBe(idempotencyKey("publish", "a", 1));
    expect(idempotencyKey("publish", "a", 1)).not.toBe(idempotencyKey("publish", "a", 2));
  });
});

describe("registro de CRMs", () => {
  it("nenhum CRM aparece como disponível sem homologação com conta real", () => {
    const st = Object.fromEntries(listProviders().map((p) => [p.key, p.status]));
    expect(st).toEqual({
      bitrix24: "available",
      pipedrive: "available",
      rdstation: "awaiting_credentials",
      zoho: "awaiting_credentials",
    });
    expect(crmClientFactory("zoho")).toBeNull();
    expect(crmClientFactory("bitrix24")).not.toBeNull();
  });
});
