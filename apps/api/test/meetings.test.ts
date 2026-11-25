import type { AddressInfo } from "node:net";
import type { TranscriptionEvents, TranscriptionProvider } from "@sci/intelligence";
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
let playbookId = "";

/** Provedor de transcrição falso: ecoa cada quadro de áudio como um resultado. */
class FakeTranscription implements TranscriptionProvider {
  name = "fake";
  audioBytes = 0;
  closed = false;
  events: TranscriptionEvents | null = null;
  async open(_o: unknown, events: TranscriptionEvents) {
    this.events = events;
    let n = 0;
    return {
      sendAudio: (chunk: Buffer) => {
        this.audioBytes += chunk.length;
        const channel = n % 2;
        events.onResult({
          channel,
          text: `parcial ${n}`,
          isFinal: false,
          startMs: n * 1000,
          endMs: n * 1000 + 500,
          confidence: 0.5,
        });
        events.onResult({
          channel,
          text: channel ? "Estamos usando pouco o sistema." : "Como está o uso?",
          isFinal: true,
          startMs: n * 1000,
          endMs: n * 1000 + 900,
          confidence: 0.9,
        });
        n++;
      },
      finalize: () => {},
      close: async () => {
        this.closed = true;
      },
    };
  }
}

function openWs(ticket: string) {
  const ws = new WebSocket(
    `${base.replace("http", "ws")}/v1/meetings/stream?ticket=${encodeURIComponent(ticket)}`,
  );
  const messages: { type: string; [k: string]: unknown }[] = [];
  ws.on("message", (d) => messages.push(JSON.parse(d.toString())));
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  return { ws, messages, closed };
}
const until = async (fn: () => boolean, ms = 15000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeAll(async () => {
  ctx = await setup();
  await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
  tenant = (
    await s.post("/platform/tenants", {
      name: "Calls Co",
      slug: "calls-co",
      admin: { name: "Ana", email: "ana@calls.com", password: "senha-ana-123456" },
    })
  ).json().id;
  otherTenant = (
    await s.post("/platform/tenants", {
      name: "Outra",
      slug: "outra-calls",
      admin: { name: "Bia", email: "bia@outra.com", password: "senha-bia-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@calls.com", "senha-ana-123456");
  other = await login(ctx, "bia@outra.com", "senha-bia-123456");
  const a = client(ctx, admin, tenant);
  customerId = (await a.post("/customers", { name: "Cliente X" })).json().id;
  playbookId = (await a.post("/playbooks", { name: "Acompanhamento", meetingType: "follow_up" })).json().id;
  const v = (
    await a.post(`/playbooks/${playbookId}/versions/manual`, {
      structure: {
        questions: [{ key: "q1", text: "Como está o uso?", type: "adoption", purpose: "Adoção" }],
      },
    })
  ).json();
  await a.post(`/playbook-versions/${v.id}/submit`);
  await a.post(`/playbook-versions/${v.id}/approve`);
  await a.post(`/playbook-versions/${v.id}/publish`);
});
afterAll(async () => ctx?.close());

describe("reuniões", () => {
  it("cria reunião com playbook publicado (versão registrada), cliente e participantes", async () => {
    const r = await client(ctx, admin, tenant).post("/meetings", {
      platform: "google_meet",
      externalRef: "abc-defg-hij",
      title: "Acompanhamento mensal",
      meetingType: "follow_up",
      customerId,
      playbookId,
      participants: [{ displayName: "Maria (cliente)", role: "customer", source: "platform" }],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      status: "preparing",
      customerName: "Cliente X",
      playbookName: "Acompanhamento",
      playbookVersionNumber: 1,
      skillVersion: "1.0.0",
    });
    expect(r.json().participants).toHaveLength(1);
  });

  it("funciona sem cliente/CRM vinculado e permite vincular depois", async () => {
    const a = client(ctx, admin, tenant);
    const m = (await a.post("/meetings", { platform: "zoom" })).json();
    expect(m.customerId).toBeNull();
    const upd = await a.patch(`/meetings/${m.id}`, { customerId });
    expect(upd.json().customerName).toBe("Cliente X");
  });

  it("rejeita playbook sem versão publicada e cliente de outro tenant", async () => {
    const a = client(ctx, admin, tenant);
    const draftOnly = (await a.post("/playbooks", { name: "Rascunho", meetingType: "other" })).json().id;
    expect((await a.post("/meetings", { platform: "teams", playbookId: draftOnly })).statusCode).toBe(400);
    const otherCustomer = (
      await client(ctx, other, otherTenant).post("/customers", { name: "Alheio" })
    ).json().id;
    expect((await a.post("/meetings", { platform: "teams", customerId: otherCustomer })).statusCode).toBe(
      400,
    );
  });

  it("sem consentimento não há captura", async () => {
    const a = client(ctx, admin, tenant);
    const m = (await a.post("/meetings", { platform: "google_meet" })).json();
    expect((await a.post(`/meetings/${m.id}/stream-ticket`)).statusCode).toBe(409);
    expect(
      (await a.post(`/meetings/${m.id}/consent`, { method: "verbal_announcement", confirmed: false }))
        .statusCode,
    ).toBe(400);
  });

  it("outro tenant não vê reuniões", async () => {
    const o = client(ctx, other, otherTenant);
    expect((await o.get("/meetings")).json()).toEqual([]);
    const mine = (await client(ctx, admin, tenant).get("/meetings")).json();
    expect((await o.get(`/meetings/${mine[0].id}`)).statusCode).toBe(404);
    expect(
      (await o.post(`/meetings/${mine[0].id}/consent`, { method: "written", confirmed: true })).statusCode,
    ).toBe(404);
  });
});

describe("captura e transcrição em tempo real", () => {
  let meetingId = "";
  const fake = new FakeTranscription();

  beforeAll(async () => {
    ctx.transcription.provider = fake;
    const a = client(ctx, admin, tenant);
    meetingId = (await a.post("/meetings", { platform: "google_meet", customerId, playbookId })).json().id;
    const c = await a.post(`/meetings/${meetingId}/consent`, {
      method: "verbal_announcement",
      confirmed: true,
    });
    expect(c.json().consentMethod).toBe("verbal_announcement");
  });

  it("ticket de uso único: transcreve, grava segmentos finais e encerra", async () => {
    const a = client(ctx, admin, tenant);
    const t = (await a.post(`/meetings/${meetingId}/stream-ticket`)).json();
    const s = openWs(t.ticket);
    await until(() => s.messages.some((m) => m.type === "ready"));
    expect((await a.get(`/meetings/${meetingId}`)).json().status).toBe("live");
    s.ws.send(Buffer.alloc(3200));
    s.ws.send(Buffer.alloc(3200));
    await until(() => s.messages.filter((m) => m.type === "segment").length === 2);
    expect(s.messages.some((m) => m.type === "interim")).toBe(true);
    s.ws.close();
    await s.closed;
    await until(() => fake.closed);
    const transcript = (await a.get(`/meetings/${meetingId}/transcript`)).json();
    expect(transcript.map((x: { speaker: string; text: string }) => [x.speaker, x.text])).toEqual([
      ["internal", "Como está o uso?"],
      ["customer", "Estamos usando pouco o sistema."],
    ]);
    expect(fake.audioBytes).toBe(6400);
    // reutilizar o ticket falha
    const again = openWs(t.ticket);
    expect(await again.closed).toBe(4401);
  });

  it("rejeita ticket inválido e quadro de áudio malformado", async () => {
    expect(await openWs("inexistente").closed).toBe(4401);
    const t = (await client(ctx, admin, tenant).post(`/meetings/${meetingId}/stream-ticket`)).json();
    const s = openWs(t.ticket);
    await until(() => s.messages.some((m) => m.type === "ready"));
    s.ws.send(Buffer.alloc(3)); // não múltiplo de 4 bytes (2 canais × 16 bits)
    expect(await s.closed).toBe(4400);
  });

  it("sem provedor de transcrição configurado: erro explícito", async () => {
    ctx.transcription.provider = null;
    const t = (await client(ctx, admin, tenant).post(`/meetings/${meetingId}/stream-ticket`)).json();
    const s = openWs(t.ticket);
    expect(await s.closed).toBe(4503);
    expect(s.messages[0]).toMatchObject({ type: "error", code: "transcription_unavailable" });
    ctx.transcription.provider = fake;
  });

  it("encerrar reunião bloqueia novas capturas", async () => {
    const a = client(ctx, admin, tenant);
    expect((await a.post(`/meetings/${meetingId}/end`)).json().status).toBe("ended");
    expect((await a.post(`/meetings/${meetingId}/stream-ticket`)).statusCode).toBe(409);
  });
});
