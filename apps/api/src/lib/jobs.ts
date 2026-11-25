import { processPlaybookVersion, QUEUES, type JobDispatcher, type ProcessorDeps } from "@sci/jobs";
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
  return {
    async processPlaybookVersion(payload) {
      await queue.add("process", payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}

/**
 * Desenvolvimento/testes: processa no próprio processo da API.
 * `wait: true` aguarda o término (determinístico em testes).
 */
export function inlineDispatcher(deps: ProcessorDeps, opts: { wait?: boolean } = {}): JobDispatcher {
  return {
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
