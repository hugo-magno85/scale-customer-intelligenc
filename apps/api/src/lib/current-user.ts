import { and, eq, roles, tenantMemberships, tenants, users, type Database } from "@sci/db";
import { isPermission, type CurrentUser } from "@sci/contracts";
import { notFound } from "./errors.js";

export async function loadCurrentUser(database: Database, userId: string): Promise<CurrentUser> {
  return database.withContext({ tenantId: null, userId }, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound("Usuário");
    const ms = await tx
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        roleId: roles.id,
        roleName: roles.name,
        permissions: roles.permissions,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "active"),
          eq(tenants.status, "active"),
        ),
      )
      .orderBy(tenants.name);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      isPlatformAdmin: u.isPlatformAdmin,
      memberships: ms.map((m) => ({ ...m, permissions: m.permissions.filter(isPermission) })),
    };
  });
}
