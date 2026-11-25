import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { sql, type Database } from "@sci/db";
import Fastify, { type FastifyError } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import { HttpError } from "./lib/errors.js";
import { contextPlugin } from "./plugins/context.js";
import { authRoutes } from "./routes/auth.js";
import { customerRoutes } from "./routes/customers.js";
import { platformRoutes } from "./routes/platform.js";
import { tenantAdminRoutes } from "./routes/tenant-admin.js";

export const API_VERSION = "0.1.0";

export async function buildApp(config: Config, database: Database) {
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: config.LOG_LEVEL,
            // Nunca registrar credenciais ou cookies de sessão.
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              'res.headers["set-cookie"]',
              "*.password",
            ],
          },
    trustProxy: true,
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("database", database);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-tenant-id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: { info: { title: "Scale Customer Intelligence API", version: API_VERSION } },
    transform: jsonSchemaTransform,
  });
  await app.register(contextPlugin);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "Dados inválidos",
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (err instanceof HttpError) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: { code: "rate_limited", message: "Muitas tentativas, aguarde um pouco" } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: err.code ?? "bad_request", message: err.message } });
    }
    req.log.error({ err }, "erro não tratado");
    return reply.status(500).send({ error: { code: "internal_error", message: "Erro interno" } });
  });

  // Health checks -------------------------------------------------------
  app.get("/health/live", { config: { rateLimit: false } }, async () => ({
    status: "ok",
    version: API_VERSION,
  }));
  app.get("/health/ready", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await database.db.execute(sql`SELECT 1`);
      return { status: "ok", checks: { database: "ok" } };
    } catch {
      return reply.status(503).send({ status: "unavailable", checks: { database: "error" } });
    }
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(platformRoutes);
      await v1.register(tenantAdminRoutes);
      await v1.register(customerRoutes);
      if (config.NODE_ENV !== "production") v1.get("/openapi.json", async () => app.swagger());
    },
    { prefix: "/v1" },
  );

  return app;
}
