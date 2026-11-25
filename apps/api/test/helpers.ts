import { createTestDb, type TestDb } from "@sci/db/testing";
import pg from "pg";
import { buildApp } from "../src/app.js";
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
  const app = await buildApp(config, db.app);
  const owner = new pg.Client({ connectionString: db.ownerUrl });
  await owner.connect();
  await provisionPlatformAdmin(owner, "super@scale.com", "Super", "super-senha-segura");
  await owner.end();
  return {
    db,
    app,
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
