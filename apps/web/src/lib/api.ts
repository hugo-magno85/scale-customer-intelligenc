"use client";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TENANT_KEY = "sci.tenant";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function getTenantId(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export function setTenantId(id: string | null) {
  try {
    if (id) localStorage.setItem(TENANT_KEY, id);
    else localStorage.removeItem(TENANT_KEY);
  } catch {
    /* armazenamento indisponível: segue sem lembrar o tenant */
  }
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown; tenant?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const tenant = init.tenant === false ? null : getTenantId();
  if (tenant) headers.set("x-tenant-id", tenant);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${BASE}/v1${path}`, { ...init, headers, body, credentials: "include" });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Erro inesperado");
  }
  return data as T;
}

export function formatBRL(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
