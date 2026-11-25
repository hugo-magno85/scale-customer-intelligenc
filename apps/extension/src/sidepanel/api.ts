import { API_URL } from "../shared/env.js";
import type { StoredAuth } from "../shared/messages.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getAuth(): Promise<StoredAuth | null> {
  const { auth } = await chrome.storage.local.get("auth");
  const a = auth as StoredAuth | undefined;
  if (!a || new Date(a.expiresAt).getTime() < Date.now()) return null;
  return a;
}

export async function getTenant(): Promise<string | null> {
  const { tenantId } = await chrome.storage.local.get("tenantId");
  return (tenantId as string | undefined) ?? null;
}

export async function setTenant(id: string) {
  await chrome.storage.local.set({ tenantId: id });
}

export async function logout() {
  await chrome.storage.local.remove(["auth", "tenantId"]);
}

export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; tenant?: boolean } = {},
): Promise<T> {
  const auth = await getAuth();
  if (!auth) throw new ApiError(401, "Sessão expirada. Conecte novamente.");
  const headers: Record<string, string> = { authorization: `Bearer ${auth.token}` };
  if (init.tenant !== false) {
    const t = await getTenant();
    if (t) headers["x-tenant-id"] = t;
  }
  if (init.json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API_URL}/v1${path}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) await logout();
    throw new ApiError(res.status, data?.error?.message ?? "Erro inesperado");
  }
  return data as T;
}

export function wsUrl(wsPath: string, ticket: string) {
  return `${API_URL.replace(/^http/, "ws")}${wsPath}?ticket=${encodeURIComponent(ticket)}`;
}
