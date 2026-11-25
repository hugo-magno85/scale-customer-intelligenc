import { z } from "zod";
import { Uuid } from "./common.js";

export const AuditLogEntry = z.object({
  id: Uuid,
  actorUserId: Uuid.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;
