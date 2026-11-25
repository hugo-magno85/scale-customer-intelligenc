import { z } from "zod";
import {
  ProviderError,
  type JsonCompletionRequest,
  type JsonCompletionResult,
  type ReasoningProvider,
} from "./types.js";

/**
 * Cliente DeepSeek via API de Chat Completions compatível com OpenAI,
 * com saída em JSON (`response_format: { type: "json_object" }`).
 *
 * URL base e IDs de modelo são configuráveis por ambiente porque a DeepSeek
 * renomeia modelos entre versões. Validar os valores na documentação oficial
 * (api-docs.deepseek.com) antes de ativar em produção.
 */
export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  fastModel: string;
  reasoningModel: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export function deepSeekConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeepSeekConfig | null {
  if (!env.DEEPSEEK_API_KEY) return null;
  return {
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    fastModel: env.DEEPSEEK_MODEL_FAST || "deepseek-chat",
    reasoningModel: env.DEEPSEEK_MODEL_REASONING || env.DEEPSEEK_MODEL_FAST || "deepseek-chat",
    timeoutMs: env.DEEPSEEK_TIMEOUT_MS ? Number(env.DEEPSEEK_TIMEOUT_MS) : undefined,
  };
}

const ChatResponse = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DeepSeekProvider implements ReasoningProvider {
  readonly name = "deepseek";
  private readonly f: typeof fetch;
  constructor(private readonly cfg: DeepSeekConfig) {
    this.f = cfg.fetch ?? fetch;
  }

  private async call(
    model: string,
    messages: { role: string; content: string }[],
    req: JsonCompletionRequest<unknown>,
  ) {
    const maxRetries = this.cfg.maxRetries ?? 2;
    let lastErr: ProviderError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.25));
      const signal = AbortSignal.any([
        AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000),
        ...(req.signal ? [req.signal] : []),
      ]);
      let res: Response;
      try {
        res = await this.f(
          `${(this.cfg.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
            body: JSON.stringify({
              model,
              messages,
              response_format: { type: "json_object" },
              temperature: req.temperature ?? 0.2,
              max_tokens: req.maxTokens ?? 4096,
              stream: false,
            }),
            signal,
          },
        );
      } catch (err) {
        if (req.signal?.aborted) throw err;
        lastErr = new ProviderError(`falha de conexão: ${(err as Error).message}`, this.name, true);
        continue;
      }
      if (res.ok) {
        const parsed = ChatResponse.safeParse(await res.json().catch(() => null));
        if (!parsed.success)
          throw new ProviderError("resposta inesperada do provedor", this.name, false, res.status);
        return parsed.data;
      }
      const retryable = res.status === 429 || res.status >= 500;
      // corpo de erro não é registrado inteiro para não vazar conteúdo
      lastErr = new ProviderError(`HTTP ${res.status}`, this.name, retryable, res.status);
      if (!retryable) throw lastErr;
    }
    throw lastErr ?? new ProviderError("falha desconhecida", this.name, true);
  }

  async completeJson<T>(req: JsonCompletionRequest<T>): Promise<JsonCompletionResult<T>> {
    const model = req.tier === "reasoning" ? this.cfg.reasoningModel : this.cfg.fastModel;
    const messages = [
      { role: "system", content: `${req.system}\n\nResponda SOMENTE com um objeto JSON válido.` },
      { role: "user", content: req.user },
    ];
    let inputTokens = 0;
    let outputTokens = 0;
    // Uma nova tentativa com o erro de validação como feedback ao modelo.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await this.call(model, messages, req as JsonCompletionRequest<unknown>);
      inputTokens += r.usage?.prompt_tokens ?? 0;
      outputTokens += r.usage?.completion_tokens ?? 0;
      const content = r.choices[0]?.message.content ?? "";
      let json: unknown;
      let problem: string;
      try {
        json = JSON.parse(content);
        const v = req.schema.safeParse(json);
        if (v.success) {
          return {
            data: v.data,
            model: r.model ?? model,
            usage: { inputTokens, outputTokens },
            attempts: attempt,
          };
        }
        problem = v.error.issues
          .slice(0, 15)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
      } catch {
        problem = content.trim() ? "o conteúdo não é JSON válido" : "resposta vazia";
      }
      messages.push({ role: "assistant", content: content.slice(0, 20_000) });
      messages.push({
        role: "user",
        content: `O JSON não atende ao formato exigido (${problem}). Corrija e responda apenas o JSON completo.`,
      });
    }
    throw new ProviderError("o modelo não produziu JSON no formato exigido", this.name, false);
  }
}
