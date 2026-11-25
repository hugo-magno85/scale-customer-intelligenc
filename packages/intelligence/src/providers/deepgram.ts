import WebSocket from "ws";
import type {
  TranscriptionEvents,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionSession,
} from "./transcription.js";

/**
 * Deepgram — transcrição em streaming (`wss://api.deepgram.com/v1/listen`).
 * Parâmetros e mensagens conferidos no SDK oficial @deepgram/sdk 5.x
 * (ListenV1 ConnectArgs; mensagens Results / UtteranceEnd / KeepAlive / CloseStream / Finalize).
 * A chave fica somente no backend; a extensão nunca fala com o Deepgram diretamente.
 */
export interface DeepgramConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  language: string;
  keepAliveMs?: number;
  connectTimeoutMs?: number;
  /** Para testes. */
  WebSocketImpl?: typeof WebSocket;
}

export function deepgramConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeepgramConfig | null {
  if (!env.DEEPGRAM_API_KEY) return null;
  return {
    apiKey: env.DEEPGRAM_API_KEY,
    baseUrl: env.DEEPGRAM_BASE_URL || "wss://api.deepgram.com",
    model: env.DEEPGRAM_MODEL || "nova-3",
    language: env.DEEPGRAM_LANGUAGE || "pt-BR",
  };
}

interface DgResults {
  type: "Results";
  channel_index: number[];
  start: number;
  duration: number;
  is_final?: boolean;
  channel: { alternatives: { transcript: string; confidence: number }[] };
}

export function buildDeepgramUrl(cfg: DeepgramConfig, opts: TranscriptionOptions): string {
  const u = new URL("/v1/listen", cfg.baseUrl ?? "wss://api.deepgram.com");
  const p = u.searchParams;
  p.set("model", cfg.model);
  p.set("language", cfg.language);
  p.set("encoding", "linear16");
  p.set("sample_rate", String(opts.sampleRate));
  p.set("channels", String(opts.channels));
  p.set("multichannel", opts.channels > 1 ? "true" : "false");
  p.set("punctuate", "true");
  p.set("smart_format", "true");
  p.set("interim_results", "true");
  p.set("endpointing", "300");
  p.set("utterance_end_ms", "1000");
  p.set("vad_events", "true");
  // não permitir uso dos dados para treinamento de modelos do fornecedor
  p.set("mip_opt_out", "true");
  for (const k of (opts.keyterms ?? []).slice(0, 50)) p.append("keyterm", k.slice(0, 80));
  return u.toString();
}

export class DeepgramProvider implements TranscriptionProvider {
  readonly name = "deepgram";
  constructor(private readonly cfg: DeepgramConfig) {}

  open(opts: TranscriptionOptions, events: TranscriptionEvents): Promise<TranscriptionSession> {
    const WS = this.cfg.WebSocketImpl ?? WebSocket;
    const ws = new WS(buildDeepgramUrl(this.cfg, opts), {
      headers: { Authorization: `Token ${this.cfg.apiKey}` },
    });
    let lastAudio = Date.now();
    let closed = false;
    const keepAlive = setInterval(() => {
      if (ws.readyState === WS.OPEN && Date.now() - lastAudio > (this.cfg.keepAliveMs ?? 8000) - 500) {
        ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, this.cfg.keepAliveMs ?? 8000);

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let msg: { type?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "Results") {
        const r = msg as DgResults;
        const alt = r.channel.alternatives[0];
        if (!alt?.transcript.trim()) return;
        events.onResult({
          channel: r.channel_index[0] ?? 0,
          text: alt.transcript.trim(),
          isFinal: !!r.is_final,
          startMs: Math.round(r.start * 1000),
          endMs: Math.round((r.start + r.duration) * 1000),
          confidence: Number.isFinite(alt.confidence) ? alt.confidence : null,
        });
      } else if (msg.type === "Error") {
        events.onError(new Error("erro reportado pelo provedor de transcrição"));
      }
    });
    ws.on("close", (code) => {
      clearInterval(keepAlive);
      if (!closed) events.onClose(`provedor encerrou a conexão (${code})`);
      closed = true;
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error("tempo esgotado ao conectar ao provedor de transcrição"));
      }, this.cfg.connectTimeoutMs ?? 10_000);
      ws.once("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        clearInterval(keepAlive);
        reject(new Error(`provedor de transcrição recusou a conexão (HTTP ${res.statusCode})`));
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        clearInterval(keepAlive);
        if (ws.readyState !== WS.OPEN) reject(err);
        else events.onError(err);
      });
      ws.once("open", () => {
        clearTimeout(timer);
        resolve({
          sendAudio(chunk) {
            if (ws.readyState === WS.OPEN) {
              lastAudio = Date.now();
              ws.send(chunk);
            }
          },
          finalize() {
            if (ws.readyState === WS.OPEN) ws.send(JSON.stringify({ type: "Finalize" }));
          },
          close() {
            return new Promise<void>((res) => {
              closed = true;
              clearInterval(keepAlive);
              if (ws.readyState !== WS.OPEN) return res();
              ws.send(JSON.stringify({ type: "CloseStream" }));
              const t = setTimeout(() => {
                ws.terminate();
                res();
              }, 3000);
              ws.once("close", () => {
                clearTimeout(t);
                res();
              });
            });
          },
        });
      });
    });
  }
}
