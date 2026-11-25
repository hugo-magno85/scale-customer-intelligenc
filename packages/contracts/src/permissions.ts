/**
 * Catálogo de permissões da plataforma. O código é a fonte da verdade;
 * cada tenant escolhe quais permissões cada papel recebe.
 */
export const PERMISSIONS = [
  "tenant.settings.read",
  "tenant.settings.manage",
  "users.read",
  "users.manage",
  "roles.manage",
  "customers.read",
  "customers.manage",
  "meetings.read",
  "meetings.capture",
  "meetings.manage",
  "playbooks.read",
  "playbooks.manage",
  "playbooks.approve",
  "skill.configure",
  "analyses.read",
  "action_plans.read",
  "action_plans.manage",
  "reports.read",
  "integrations.read",
  "integrations.manage",
  "crm.publish",
  "crm.link.change",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = ["tenant_admin", "manager", "cs", "analyst"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  tenant_admin: "Administrador do tenant",
  manager: "Gestor",
  cs: "Customer Success",
  analyst: "Analista",
};

const ALL = [...PERMISSIONS];

/** Permissões padrão de cada papel de sistema quando um tenant é criado. */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  tenant_admin: ALL,
  manager: [
    "tenant.settings.read",
    "users.read",
    "customers.read",
    "customers.manage",
    "meetings.read",
    "meetings.capture",
    "meetings.manage",
    "playbooks.read",
    "playbooks.manage",
    "playbooks.approve",
    "analyses.read",
    "action_plans.read",
    "action_plans.manage",
    "reports.read",
    "integrations.read",
    "crm.publish",
    "crm.link.change",
    "audit.read",
  ],
  cs: [
    "customers.read",
    "customers.manage",
    "meetings.read",
    "meetings.capture",
    "playbooks.read",
    "analyses.read",
    "action_plans.read",
    "action_plans.manage",
    "reports.read",
    "crm.publish",
  ],
  analyst: [
    "customers.read",
    "meetings.read",
    "playbooks.read",
    "analyses.read",
    "action_plans.read",
    "reports.read",
  ],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
