import { z } from "zod";
import { PERMISSIONS } from "./permissions.js";
import { Uuid } from "./common.js";

export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Política mínima de senha: 12+ caracteres. */
export const Password = z.string().min(12, "a senha precisa ter pelo menos 12 caracteres").max(200);

export const LoginRequest = z.object({ email: Email, password: z.string().min(1).max(200) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const MembershipSummary = z.object({
  tenantId: Uuid,
  tenantName: z.string(),
  tenantSlug: z.string(),
  roleId: Uuid,
  roleName: z.string(),
  permissions: z.array(z.enum(PERMISSIONS)),
});
export type MembershipSummary = z.infer<typeof MembershipSummary>;

export const CurrentUser = z.object({
  id: Uuid,
  email: z.string(),
  name: z.string(),
  isPlatformAdmin: z.boolean(),
  memberships: z.array(MembershipSummary),
});
export type CurrentUser = z.infer<typeof CurrentUser>;

export const LoginResponse = z.object({ user: CurrentUser });
export type LoginResponse = z.infer<typeof LoginResponse>;
