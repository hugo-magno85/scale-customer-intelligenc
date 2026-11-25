import { z } from "zod";

export const QUEUES = {
  maintenance: "sci.maintenance",
  playbooks: "sci.playbooks",
  analysis: "sci.analysis",
} as const;

export const PlaybookProcessPayload = z.object({
  tenantId: z.uuid(),
  versionId: z.uuid(),
  requestedBy: z.uuid().nullable(),
});
export type PlaybookProcessPayload = z.infer<typeof PlaybookProcessPayload>;

/** Abstração de enfileiramento usada pela API (BullMQ em produção; síncrono em testes). */
export interface JobDispatcher {
  processPlaybookVersion(payload: PlaybookProcessPayload): Promise<void>;
  analyzeMeeting(payload: {
    tenantId: string;
    analysisId: string;
    requestedBy: string | null;
  }): Promise<void>;
}
