import type { z } from "zod";

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface JsonCompletionRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** "fast" para tempo real; "reasoning" para análises mais profundas. */
  tier?: "fast" | "reasoning";
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface JsonCompletionResult<T> {
  data: T;
  model: string;
  usage: Usage;
  attempts: number;
}

/** Raciocínio e linguagem (DeepSeek). */
export interface ReasoningProvider {
  readonly name: string;
  completeJson<T>(req: JsonCompletionRequest<T>): Promise<JsonCompletionResult<T>>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
  }
}
