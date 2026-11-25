import { DEFAULT_ROLE_PERMISSIONS, SYSTEM_ROLE_LABELS, SYSTEM_ROLES, type SystemRole } from "@sci/contracts";
import { roles, sql, users, type Tx } from "@sci/db";
import { hashPassword } from "@sci/security";
import { randomUUID } from "node:crypto";
import { badRequest } from "./errors.js";

/** Troca o tenant do contexto dentro da transação corrente. */
export async function switchTenant(tx: Tx, tenantId: string) {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}

export async function createDefaultRoles(tx: Tx, tenantId: string): Promise<Record<SystemRole, string>> {
  const out = {} as Record<SystemRole, string>;
  for (const key of SYSTEM_ROLES) {
    const [r] = await tx
      .insert(roles)
      .values({
        tenantId,
        name: SYSTEM_ROLE_LABELS[key],
        systemKey: key,
        permissions: DEFAULT_ROLE_PERMISSIONS[key],
      })
      .returning({ id: roles.id });
    out[key] = r!.id;
  }
  return out;
}

/**
 * Retorna o id do usuário com o e-mail informado, criando-o se ainda não
 * existir na plataforma. Requer contexto de tenant (política users_insert).
 */
export async function findOrCreateUser(
  tx: Tx,
  input: { email: string; name: string; password?: string | undefined },
): Promise<{ userId: string; created: boolean }> {
  const found = await tx.execute<{ id: string }>(
    sql`SELECT id FROM app.auth_find_user_by_email(${input.email})`,
  );
  const existing = found.rows[0];
  if (existing) return { userId: existing.id, created: false };
  if (!input.password) throw badRequest("Senha obrigatória para um usuário novo");
  const id = randomUUID();
  await tx.insert(users).values({
    id,
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
  });
  return { userId: id, created: true };
}
