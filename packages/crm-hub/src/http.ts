import { createHash } from "node:crypto";

export class CrmHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Limitador simples por conexão (token bucket) para respeitar o rate limit de cada CRM. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  constructor(
    private readonly perSecond: number,
    private readonly burst = perSecond,
    private readonly now = () => Date.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }
  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSecond);
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.tokens) / this.perSecond) * 1000)));
    }
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  limiter?: RateLimiter;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Requisição com timeout, retry exponencial em 429/5xx e respeito a Retry-After. */
export async function requestJson<T>(url: string, o: RequestOptions = {}): Promise<T> {
  const f = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const max = o.maxRetries ?? 3;
  let last: CrmHttpError | null = null;
  for (let attempt = 0; attempt <= max; attempt++) {
    await o.limiter?.take();
    let res: Response;
    try {
      res = await f(url, {
        method: o.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
          ...o.headers,
        },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
      });
    } catch (err) {
      last = new CrmHttpError(`falha de conexão com o CRM: ${(err as Error).message}`, null, true);
      if (attempt < max) await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    last = new CrmHttpError(
      res.status === 401 || res.status === 403
        ? "credenciais do CRM recusadas ou sem permissão"
        : `CRM respondeu HTTP ${res.status}`,
      res.status,
      retryable,
    );
    if (!retryable || attempt === max) break;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60_000) : backoff(attempt));
  }
  throw last ?? new CrmHttpError("falha desconhecida", null, false);
}

function backoff(attempt: number) {
  return Math.min(8000, 500 * 2 ** attempt);
}

/** Chave de idempotência estável para uma operação (ex.: publicar a análise X no registro Y). */
export function idempotencyKey(...parts: (string | number)[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}
