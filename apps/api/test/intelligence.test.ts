import type { AddressInfo } from "node:net";
import type { TranscriptionEvents, TranscriptionProvider } from "@sci/intelligence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { client, login, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
let base = "";
let admin = "";
let tenant = "";
let analyst = "";
let other = "";
let otherTenant = "";
let playbookId = "";

class ScriptedTranscription implements TranscriptionProvider {
  name = "scripted";
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
            startMs: i * 1000,
            endMs: i * 1000 + 800,
            confidence: 0.9,
          });
      },
      finalize: () => {},
      close: async () => {},
    };
  }
}
const until = async (fn: () => boolean, ms = 6000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeAll(async () => {
  ctx = await setup();
  await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  base = `ws://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  const s = client(ctx, await login(ctx, "super@scale.com", "super-senha-segura"));
  tenant = (
    await s.post("/platform/tenants", {
      name: "Intel Co",
      slug: "intel-co",
      admin: { name: "Ana", email: "ana@intel.com", password: "senha-ana-123456" },
    })
  ).json().id;
  otherTenant = (
    await s.post("/platform/tenants", {
      name: "Outra",
      slug: "outra-intel",
      admin: { name: "Bia", email: "bia@intel2.com", password: "senha-bia-123456" },
    })
  ).json().id;
  admin = await login(ctx, "ana@intel.com", "senha-ana-123456");
  other = await login(ctx, "bia@intel2.com", "senha-bia-123456");
  const a = client(ctx, admin, tenant);
  const roles = (await a.get("/roles")).json();
  await a.post("/members", {
    name: "Ivo Analista",
    email: "ivo@intel.com",
    password: "senha-ivo-123456",
    roleId: roles.find((r: { systemKey: string }) => r.systemKey === "analyst").id,
  });
  analyst = await login(ctx, "ivo@intel.com", "senha-ivo-123456");
  playbookId = (await a.post("/playbooks", { name: "Acompanhamento", meetingType: "follow_up" })).json().id;
  const v = (
    await a.post(`/playbooks/${playbookId}/versions/manual`, {
      structure: {
        questions: [
          {
            key: "prioridades",
            text: "Quais são as prioridades da equipe neste trimestre?",
            type: "diagnosis",
            purpose: "Entender prioridades",
            priority: "high",
            required: true,
            weight: 5,
          },
        ],
      },
    })
  ).json();
  for (const st of ["submit", "approve", "publish"]) await a.post(`/playbook-versions/${v.id}/${st}`);
});
afterAll(async () => ctx?.close());

describe("Modo Preparação e ações do profissional", () => {
  let meetingId = "";
  it("prepara: primeira pergunta do playbook, checklist e pontos a investigar", async () => {
    const a = client(ctx, admin, tenant);
    meetingId = (
      await a.post("/meetings", {
        platform: "google_meet",
        playbookId,
        meetingType: "follow_up",
        objective: "Revisar adoção",
      })
    ).json().id;
    const s = (await a.get(`/meetings/${meetingId}/intelligence`)).json();
    expect(s.mode).toBe("preparation");
    expect(s.current).toMatchObject({
      question: "Quais são as prioridades da equipe neste trimestre?",
      playbookRef: { questionKey: "prioridades" },
    });
    expect(s.current.reason).toContain("playbook");
    expect(s.checklist.map((c: { key: string }) => c.key)).toEqual(
      expect.arrayContaining(["pb:prioridades", "topic:next_steps"]),
    );
    expect(s.preparationNotes.join(" ")).toContain("Revisar adoção");
    expect(s.degraded.length).toBeGreaterThan(0);
  });

  it("marcar como realizada cobre o item do playbook e traz a próxima", async () => {
    const a = client(ctx, admin, tenant);
    const s = (await a.get(`/meetings/${meetingId}/intelligence`)).json();
    const r = (await a.post(`/meetings/${meetingId}/suggestions/${s.current.id}/done`)).json();
    expect(r.checklist.find((c: { key: string }) => c.key === "pb:prioridades").status).toBe("covered");
    expect(r.current.id).not.toBe(s.current.id);
  });

  it("ignorar, pedir outra e registrar observação", async () => {
    const a = client(ctx, admin, tenant);
    const s1 = (await a.get(`/meetings/${meetingId}/intelligence`)).json();
    const s2 = (await a.post(`/meetings/${meetingId}/suggestions/${s1.current.id}/ignore`)).json();
    const s3 = (await a.post(`/meetings/${meetingId}/suggestions/next`)).json();
    expect(new Set([s1.current.question, s2.current.question, s3.current.question]).size).toBe(3);
    const n = await a.post(`/meetings/${meetingId}/notes`, {
      text: "Cliente pediu material de treinamento",
      suggestionId: s3.current.id,
    });
    expect(n.statusCode).toBe(201);
    expect((await a.get(`/meetings/${meetingId}/notes`)).json()).toHaveLength(1);
  });

  it("estado sobrevive a reinício (restaurado do banco)", async () => {
    const a = client(ctx, admin, tenant);
    const before = (await a.get(`/meetings/${meetingId}/intelligence`)).json();
    ctx.app.brains.drop(meetingId);
    const after = (await a.get(`/meetings/${meetingId}/intelligence`)).json();
    expect(after.current.id).toBe(before.current.id);
    expect(after.checklist.find((c: { key: string }) => c.key === "pb:prioridades").status).toBe("covered");
  });

  it("analista vê, mas não interage; outro tenant não vê", async () => {
    expect((await client(ctx, analyst, tenant).get(`/meetings/${meetingId}/intelligence`)).statusCode).toBe(
      200,
    );
    expect(
      (await client(ctx, analyst, tenant).post(`/meetings/${meetingId}/suggestions/next`)).statusCode,
    ).toBe(403);
    expect(
      (await client(ctx, other, otherTenant).get(`/meetings/${meetingId}/intelligence`)).statusCode,
    ).toBe(404);
    expect(
      (await client(ctx, other, otherTenant).post(`/meetings/${meetingId}/notes`, { text: "x" })).statusCode,
    ).toBe(404);
  });
});

describe("Modo Copiloto: transcrição → sinal → pergunta em tempo real", () => {
  it("recomenda a pergunta de adoção com motivo e evidência a partir da fala do cliente", async () => {
    ctx.transcription.provider = new ScriptedTranscription([
      { channel: 0, text: "Como estão as coisas por aí?" },
      {
        channel: 1,
        text: "Estamos utilizando pouco o sistema porque nossa equipe ainda não conseguiu se adaptar.",
      },
    ]);
    const a = client(ctx, admin, tenant);
    const meetingId = (
      await a.post("/meetings", { platform: "google_meet", meetingType: "follow_up" })
    ).json().id;
    await a.post(`/meetings/${meetingId}/consent`, { method: "verbal_announcement", confirmed: true });
    const prep = (await a.get(`/meetings/${meetingId}/intelligence`)).json();
    const t = (await a.post(`/meetings/${meetingId}/stream-ticket`)).json();
    const ws = new WebSocket(`${base}${t.wsPath}?ticket=${t.ticket}`);
    const msgs: {
      type: string;
      state?: {
        current: {
          question: string;
          reason: string;
          evidence: { text: string } | null;
          priority: string;
        } | null;
        signals: { key: string }[];
      };
    }[] = [];
    ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
    await until(() => msgs.some((m) => m.type === "ready"));
    expect(msgs.find((m) => m.type === "intelligence")!.state!.current!.question).toBe(prep.current.question);
    ws.send(Buffer.alloc(3200));
    ws.send(Buffer.alloc(3200));
    await until(() => msgs.filter((m) => m.type === "segment").length === 2);
    // o profissional pede outra sugestão após o sinal
    await until(() => msgs.some((m) => m.type === "intelligence" && (m.state?.signals.length ?? 0) > 0));
    const s = (await a.post(`/meetings/${meetingId}/suggestions/next`)).json();
    expect(s.signals[0]).toMatchObject({ key: "low_adoption", evidence: { speaker: "customer" } });
    expect(s.current.question).toBe(
      "Quais funcionalidades estão apresentando maior dificuldade para a equipe utilizar no dia a dia?",
    );
    expect(s.current.evidence.text).toContain("utilizando pouco");
    expect(s.current.priority).toBe("high");
    ws.close();
  });
});
