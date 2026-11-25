import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { buildDeepgramUrl, DeepgramProvider, type TranscriptResult } from "./index.js";

let server: WebSocketServer | null = null;
afterEach(async () => {
  server?.close();
  server = null;
});

async function fakeDeepgram(onConn: (ws: WebSocket, req: import("node:http").IncomingMessage) => void) {
  server = new WebSocketServer({ port: 0 });
  server.on("connection", onConn);
  await once(server, "listening");
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("Deepgram", () => {
  it("monta a URL com multicanal, pt-BR, opt-out e keyterms", () => {
    const url = new URL(
      buildDeepgramUrl(
        { apiKey: "k", model: "nova-3", language: "pt-BR" },
        { sampleRate: 16000, channels: 2, keyterms: ["Scale", "CRM"] },
      ),
    );
    expect(url.origin + url.pathname).toBe("wss://api.deepgram.com/v1/listen");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      model: "nova-3",
      language: "pt-BR",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "2",
      multichannel: "true",
      mip_opt_out: "true",
    });
    expect(url.searchParams.getAll("keyterm")).toEqual(["Scale", "CRM"]);
  });

  it("autentica com Token, repassa áudio, converte resultados e fecha com CloseStream", async () => {
    const received: (Buffer | string)[] = [];
    let auth = "";
    const base = await fakeDeepgram((ws, req) => {
      auth = String(req.headers.authorization);
      ws.on("message", (d, bin) => {
        received.push(bin ? (d as Buffer) : d.toString());
        if (bin) {
          ws.send(
            JSON.stringify({
              type: "Results",
              channel_index: [1, 2],
              start: 1.5,
              duration: 2,
              is_final: true,
              channel: {
                alternatives: [{ transcript: " Estamos usando pouco o sistema. ", confidence: 0.93 }],
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "Results",
              channel_index: [0, 2],
              start: 4,
              duration: 1,
              is_final: false,
              channel: { alternatives: [{ transcript: "entendi", confidence: 0.8 }] },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "Results",
              channel_index: [0, 2],
              start: 5,
              duration: 1,
              is_final: true,
              channel: { alternatives: [{ transcript: "  ", confidence: 0 }] },
            }),
          );
        } else if (JSON.parse(d.toString()).type === "CloseStream") ws.close(1000);
      });
    });
    const results: TranscriptResult[] = [];
    const p = new DeepgramProvider({ apiKey: "segredo", baseUrl: base, model: "nova-3", language: "pt-BR" });
    const s = await p.open(
      { sampleRate: 16000, channels: 2 },
      { onResult: (r) => results.push(r), onError: () => {}, onClose: () => {} },
    );
    s.sendAudio(Buffer.alloc(640));
    await new Promise((r) => setTimeout(r, 100));
    await s.close();
    expect(auth).toBe("Token segredo");
    expect(results).toEqual([
      {
        channel: 1,
        text: "Estamos usando pouco o sistema.",
        isFinal: true,
        startMs: 1500,
        endMs: 3500,
        confidence: 0.93,
      },
      { channel: 0, text: "entendi", isFinal: false, startMs: 4000, endMs: 5000, confidence: 0.8 },
    ]);
    expect(JSON.parse(received.at(-1) as string)).toEqual({ type: "CloseStream" });
  });

  it("rejeita quando o provedor recusa a conexão", async () => {
    server = new WebSocketServer({ port: 0, verifyClient: (_i, cb) => cb(false, 401) });
    await once(server, "listening");
    const p = new DeepgramProvider({
      apiKey: "x",
      baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      model: "nova-3",
      language: "pt-BR",
    });
    await expect(
      p.open(
        { sampleRate: 16000, channels: 2 },
        { onResult: () => {}, onError: () => {}, onClose: () => {} },
      ),
    ).rejects.toThrow(/401/);
  });
});
