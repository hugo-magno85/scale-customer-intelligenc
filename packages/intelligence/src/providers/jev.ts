import {
  TypeSafeClient,
  type Questions,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

export { choice, noul, score } from "@typesafe-ai/sdk";
export type { Questions } from "@typesafe-ai/sdk";

/**
 * Decisões tipadas (Jev / TypeSafe AI): perguntas fechadas sobre um estado
 * (texto ou JSON) com respostas estruturadas e probabilidades — nunca prosa.
 */
export interface DecisionProvider {
  readonly name: string;
  decide<Q extends Questions>(
    req: SystemOneRequest<Q>,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<SystemOneResult<Q>>;
}

export function jevFromEnv(env: NodeJS.ProcessEnv = process.env): DecisionProvider | null {
  if (!env.TYPESAFE_API_KEY) return null;
  return new JevDecisionProvider(
    new TypeSafeClient({
      apiKey: env.TYPESAFE_API_KEY,
      ...(env.TYPESAFE_BASE_URL ? { baseURL: env.TYPESAFE_BASE_URL } : {}),
      ...(env.TYPESAFE_DEFAULT_MODEL ? { defaultModel: env.TYPESAFE_DEFAULT_MODEL } : {}),
    }),
  );
}

export class JevDecisionProvider implements DecisionProvider {
  readonly name = "jev";
  constructor(private readonly client: Pick<TypeSafeClient, "systemOne">) {}
  decide<Q extends Questions>(
    req: SystemOneRequest<Q>,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ) {
    return this.client.systemOne(req, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      timeout: opts.timeoutMs ?? 15_000,
    }) as unknown as Promise<SystemOneResult<Q>>;
  }
}
