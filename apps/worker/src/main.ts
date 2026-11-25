import { createServer } from "node:http";
import { createDatabase, sql } from "@sci/db";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { pino } from "pino";
import { z } from "zod";
import { purgeExpiredSessions } from "./jobs/maintenance.js";
import { deepSeekConfigFromEnv, DeepSeekProvider, jevFromEnv } from "@sci/intelligence";
import {
  MeetingAnalysisPayload,
  PlaybookProcessPayload,
  processMeetingAnalysis,
  processPlaybookVersion,
  QUEUES,
} from "@sci/jobs";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    WORKER_HEALTH_PORT: z.coerce.number().int().default(4100),
    LOG_LEVEL: z.string().default("info"),
  })
  .parse(process.env);

const log = pino({ level: env.LOG_LEVEL });
const database = createDatabase(env.DATABASE_URL, { max: 5 });
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const maintenanceQueue = new Queue(QUEUES.maintenance, { connection });
await maintenanceQueue.upsertJobScheduler(
  "purge-sessions",
  { pattern: "17 3 * * *" },
  { name: "purge-sessions" },
);

const worker = new Worker(
  QUEUES.maintenance,
  async (job) => {
    if (job.name === "purge-sessions") {
      const n = await purgeExpiredSessions(database);
      log.info({ job: job.name, removed: n }, "sessões expiradas removidas");
      return { removed: n };
    }
    throw new Error(`job desconhecido: ${job.name}`);
  },
  { connection, concurrency: 1 },
);
worker.on("failed", (job, err) => log.error({ job: job?.name, err: err.message }, "job falhou"));

// Playbook Intelligence: extração + interpretação (DeepSeek) + classificação (Jev)
const ds = deepSeekConfigFromEnv();
if (!ds)
  log.warn("DEEPSEEK_API_KEY ausente: playbooks enviados terão a interpretação marcada como indisponível");
const processorDeps = {
  database,
  reasoning: ds ? new DeepSeekProvider(ds) : null,
  decisions: jevFromEnv(),
  log: { info: (o: object, m: string) => log.info(o, m), warn: (o: object, m: string) => log.warn(o, m) },
};
const playbookWorker = new Worker(
  QUEUES.playbooks,
  async (job) => ({
    outcome: await processPlaybookVersion(processorDeps, PlaybookProcessPayload.parse(job.data)),
  }),
  { connection, concurrency: 2 },
);
// Modo Análise: pós-reunião (indicadores, Health, Churn Radar, Expansão, Planos de Ação)
const analysisWorker = new Worker(
  QUEUES.analysis,
  async (job) => ({
    outcome: await processMeetingAnalysis(processorDeps, MeetingAnalysisPayload.parse(job.data)),
  }),
  { connection, concurrency: 2 },
);
analysisWorker.on("failed", (job, err) =>
  log.error({ queue: QUEUES.analysis, jobId: job?.id, err: err.message }, "job de análise falhou"),
);
playbookWorker.on("failed", (job, err) =>
  log.error({ queue: QUEUES.playbooks, jobId: job?.id, err: err.message }, "job de playbook falhou"),
);

const health = createServer(async (req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  try {
    await database.db.execute(sql`SELECT 1`);
    await connection.ping();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
  } catch {
    res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "unavailable" }));
  }
});
health.listen(env.WORKER_HEALTH_PORT);
log.info({ queues: Object.values(QUEUES) }, "worker iniciado");

const shutdown = async () => {
  await worker.close();
  await playbookWorker.close();
  await analysisWorker.close();
  await maintenanceQueue.close();
  connection.disconnect();
  await database.close();
  health.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
