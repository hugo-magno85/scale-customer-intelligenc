import {
  processMeetingAnalysis,
  processPlaybookVersion,
  QUEUES,
  type AnalysisDeps,
  type JobDispatcher,
  type ProcessorDeps,
} from "@sci/jobs";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    jobs: JobDispatcher;
  }
}

/** Produção/homologação: enfileira no Redis para o worker processar. */
export function bullmqDispatcher(redisUrl: string): JobDispatcher & { close(): Promise<void> } {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUES.playbooks, { connection });
  const analysisQueue = new Queue(QUEUES.analysis, { connection });
  return {
    async processPlaybookVersion(payload) {
      await queue.add("process", payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async analyzeMeeting(payload) {
      await analysisQueue.add("analyze", payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async close() {
      await queue.close();
      await analysisQueue.close();
      connection.disconnect();
    },
  };
}

/**
 * Desenvolvimento/testes: processa no próprio processo da API.
 * `wait: true` aguarda o término (determinístico em testes).
 */
export function inlineDispatcher(
  deps: ProcessorDeps & AnalysisDeps,
  opts: { wait?: boolean } = {},
): JobDispatcher {
  return {
    async analyzeMeeting(payload) {
      const run = processMeetingAnalysis(deps, payload).catch((err: Error) =>
        deps.log?.warn({ err: err.message, analysisId: payload.analysisId }, "falha inesperada na análise"),
      );
      if (opts.wait) await run;
    },
    async processPlaybookVersion(payload) {
      const run = processPlaybookVersion(deps, payload).catch((err: Error) =>
        deps.log?.warn(
          { err: err.message, versionId: payload.versionId },
          "falha inesperada no processamento",
        ),
      );
      if (opts.wait) await run;
    },
  };
}
