import { createDatabase } from "@sci/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL, { max: 20 });
const app = await buildApp(config, database);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "encerrando");
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
