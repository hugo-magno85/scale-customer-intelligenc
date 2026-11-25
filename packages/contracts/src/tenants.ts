import { z } from "zod";
import { Slug, Uuid } from "./common.js";
import { Email, Password } from "./auth.js";
import { PERMISSIONS, SYSTEM_ROLES } from "./permissions.js";

export const TenantStatus = z.enum(["active", "suspended"]);

export const Tenant = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  status: TenantStatus,
  createdAt: z.string(),
});
export type Tenant = z.infer<typeof Tenant>;

/** Criação de tenant pelo superadmin, já com o primeiro administrador. */
export const CreateTenantRequest = z.object({
  name: z.string().trim().min(2).max(120),
  slug: Slug,
  admin: z.object({
    name: z.string().trim().min(2).max(120),
    email: Email,
    password: Password,
  }),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequest>;

export const Role = z.object({
  id: Uuid,
  name: z.string(),
  systemKey: z.enum(SYSTEM_ROLES).nullable(),
  permissions: z.array(z.enum(PERMISSIONS)),
});
export type Role = z.infer<typeof Role>;

export const UpdateRolePermissionsRequest = z.object({
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});

export const TenantMember = z.object({
  userId: Uuid,
  name: z.string(),
  email: z.string(),
  roleId: Uuid,
  roleName: z.string(),
  status: z.enum(["active", "disabled"]),
  createdAt: z.string(),
});
export type TenantMember = z.infer<typeof TenantMember>;

export const AddMemberRequest = z.object({
  name: z.string().trim().min(2).max(120),
  email: Email,
  /** Obrigatória só quando o usuário ainda não existe na plataforma. */
  password: Password.optional(),
  roleId: Uuid,
});
export type AddMemberRequest = z.infer<typeof AddMemberRequest>;

export const UpdateMemberRequest = z.object({
  roleId: Uuid.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
