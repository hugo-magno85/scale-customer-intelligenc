import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  /** Origens permitidas para o frontend e a extensão (separadas por vírgula). */
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24 * 7),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  COOKIE_DOMAIN: z.string().optional(),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(10),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
});

export type Config = z.infer<typeof Env> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`configuração inválida: ${fields}`);
  }
  const cfg = parsed.data;
  if ((cfg.NODE_ENV === "production" || cfg.NODE_ENV === "staging") && !cfg.COOKIE_SECURE) {
    throw new Error("COOKIE_SECURE precisa ser true em staging/produção");
  }
  return {
    ...cfg,
    corsOrigins: cfg.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
