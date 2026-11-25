import { createTestDb, type TestDb } from "@sci/db/testing";
import pg from "pg";
import type { ReasoningProvider } from "@sci/intelligence";
import { buildApp } from "../src/app.js";
import { inlineDispatcher } from "../src/lib/jobs.js";
import { provisionPlatformAdmin } from "../src/lib/provision-admin.js";
import { loadConfig } from "../src/config.js";

export const ORIGIN = "http://localhost:3000";

export async function setup() {
  const db: TestDb = await createTestDb();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: db.appUrl,
    CORS_ORIGINS: ORIGIN,
    LOGIN_RATE_LIMIT_PER_MINUTE: "1000",
  });
  const ai: { reasoning: ReasoningProvider | null; output: unknown } = { reasoning: null, output: null };
  const fakeReasoning: ReasoningProvider = {
    name: "fake",
    async completeJson(req) {
      return {
        data: req.schema.parse(ai.output),
        model: "fake-model",
        usage: { inputTokens: 1, outputTokens: 1 },
        attempts: 1,
      };
    },
  };
  ai.reasoning = fakeReasoning;
  const deps = {
    database: db.app,
    get reasoning() {
      return ai.reasoning;
    },
    decisions: null,
  };
  const app = await buildApp(config, db.app, inlineDispatcher(deps, { wait: true }));
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();
  await provisionPlatformAdmin(owner, "super@scale.com", "Super", "super-senha-segura");
  await owner.end();
  return {
    db,
    app,
    ai,
    fakeReasoning,
    async close() {
      await app.close();
      await db.drop();
    },
  };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;

export async function login(ctx: Ctx, email: string, password: string): Promise<string> {
  const res = await ctx.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === "sci_session");
  return c!.value;
}

export function upload(
  ctx: Ctx,
  cookie: string,
  tenantId: string,
  url: string,
  files: { name: string; content: string | Buffer }[],
) {
  const boundary = "----scitest" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
    );
    parts.push(Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return ctx.app.inject({
    method: "POST",
    url: `/v1${url}`,
    headers: {
      origin: ORIGIN,
      "x-tenant-id": tenantId,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    cookies: { sci_session: cookie },
    payload: Buffer.concat(parts),
  });
}

export function client(ctx: Ctx, cookie: string, tenantId?: string) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (tenantId) headers["x-tenant-id"] = tenantId;
  const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) =>
    ctx.app.inject({
      method,
      url: `/v1${url}`,
      headers,
      cookies: { sci_session: cookie },
      ...(payload ? { payload: payload as object } : {}),
    });
  return {
    get: (u: string) => call("GET", u),
    post: (u: string, p?: unknown) => call("POST", u, p),
    patch: (u: string, p?: unknown) => call("PATCH", u, p),
    put: (u: string, p?: unknown) => call("PUT", u, p),
    del: (u: string) => call("DELETE", u),
  };
}
