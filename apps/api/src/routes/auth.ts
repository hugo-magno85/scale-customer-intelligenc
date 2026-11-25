import { CurrentUser, LoginRequest, LoginResponse } from "@sci/contracts";
import { eq, sessions, sql, users } from "@sci/db";
import { dummyHash, generateToken, hashToken, verifyPassword } from "@sci/security";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { loadCurrentUser } from "../lib/current-user.js";
import { HttpError, unauthorized } from "../lib/errors.js";
import { requireAuth, SESSION_COOKIE } from "../plugins/context.js";

export async function authRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();
  const ttlMs = () => app.config.SESSION_TTL_HOURS * 3600_000;

  async function createSession(userId: string, kind: "web" | "extension", ip: string, ua?: string) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + ttlMs()).toISOString();
    await app.database.withContext({ tenantId: null, userId }, async (tx) => {
      await tx.insert(sessions).values({
        userId,
        tokenHash: hashToken(token),
        kind,
        ip,
        userAgent: ua?.slice(0, 500) ?? null,
        expiresAt,
      });
    });
    return { token, expiresAt };
  }

  app.post(
    "/auth/login",
    {
      schema: { tags: ["auth"], body: LoginRequest, response: { 200: LoginResponse } },
      config: {
        rateLimit: {
          max: app.config.LOGIN_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
          keyGenerator: (req) =>
            `${req.ip}:${String((req.body as { email?: string })?.email ?? "").toLowerCase()}`,
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const found = await app.database.withContext({ tenantId: null, userId: null }, (tx) =>
        tx.execute<{ id: string; password_hash: string; status: string }>(
          sql`SELECT * FROM app.auth_find_user_by_email(${email})`,
        ),
      );
      const u = found.rows[0];
      // Sempre verifica um hash para não revelar, pelo tempo, se o e-mail existe.
      const ok = await verifyPassword(u?.password_hash ?? (await dummyHash()), password);
      if (!u || !ok || u.status !== "active") {
        req.log.info({ event: "login_failed" }, "falha de login");
        throw new HttpError(401, "invalid_credentials", "E-mail ou senha inválidos");
      }
      const { token, expiresAt } = await createSession(u.id, "web", req.ip, req.headers["user-agent"]);
      await app.database.withContext({ tenantId: null, userId: u.id }, async (tx) => {
        await tx
          .update(users)
          .set({ lastLoginAt: sql`now()` })
          .where(eq(users.id, u.id));
        await audit(tx, req, { action: "auth.login", entityType: "user", entityId: u.id, tenantId: null });
      });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: app.config.COOKIE_SECURE,
        sameSite: "lax",
        path: "/",
        domain: app.config.COOKIE_DOMAIN,
        expires: new Date(expiresAt),
      });
      return { user: await loadCurrentUser(app.database, u.id) };
    },
  );

  app.post("/auth/logout", { schema: { tags: ["auth"] }, preHandler: requireAuth }, async (req, reply) => {
    const auth = req.auth!;
    await app.database.withContext({ tenantId: null, userId: auth.userId }, (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(eq(sessions.id, auth.sessionId)),
    );
    reply.clearCookie(SESSION_COOKIE, { path: "/", domain: app.config.COOKIE_DOMAIN });
    return reply.status(204).send();
  });

  app.get(
    "/auth/me",
    { schema: { tags: ["auth"], response: { 200: CurrentUser } }, preHandler: requireAuth },
    async (req) => loadCurrentUser(app.database, req.auth!.userId),
  );

  /**
   * Emite um token para o Scale Assistant (extensão). Só pode ser chamado a
   * partir de uma sessão web; o token aparece uma única vez e pode ser revogado.
   */
  app.post(
    "/auth/extension-token",
    {
      schema: {
        tags: ["auth"],
        response: { 201: z.object({ token: z.string(), expiresAt: z.string() }) },
      },
      preHandler: requireAuth,
    },
    async (req, reply) => {
      const auth = req.auth!;
      if (auth.sessionKind !== "web") throw unauthorized();
      const s = await createSession(auth.userId, "extension", req.ip, req.headers["user-agent"]);
      await app.database.withContext({ tenantId: null, userId: auth.userId }, (tx) =>
        audit(tx, req, {
          action: "auth.extension_token.issued",
          entityType: "user",
          entityId: auth.userId,
          tenantId: null,
        }),
      );
      return reply.status(201).send(s);
    },
  );
}
