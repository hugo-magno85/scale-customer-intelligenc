import { auditLogs, type Tx } from "@sci/db";
import type { FastifyRequest } from "fastify";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  tenantId?: string | null;
}

/** Registra auditoria na MESMA transação da alteração (atômico). */
export async function audit(tx: Tx, req: FastifyRequest, input: AuditInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId === undefined ? (req.tenant?.tenantId ?? null) : input.tenantId,
    actorUserId: req.auth?.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
  });
}
