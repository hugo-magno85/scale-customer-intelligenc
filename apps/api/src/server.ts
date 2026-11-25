import { createDatabase } from "@sci/db";
import { deepSeekConfigFromEnv, DeepSeekProvider, jevFromEnv } from "@sci/intelligence";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { bullmqDispatcher, inlineDispatcher } from "./lib/jobs.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL, { max: 20 });
const ds = deepSeekConfigFromEnv();
const queue = config.REDIS_URL ? bullmqDispatcher(config.REDIS_URL) : null;
const jobs =
  queue ??
  inlineDispatcher({ database, reasoning: ds ? new DeepSeekProvider(ds) : null, decisions: jevFromEnv() });
const app = await buildApp(config, database, jobs);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "encerrando");
  await app.close();
  await queue?.close();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
