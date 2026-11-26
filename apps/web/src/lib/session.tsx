"use client";

import type { CurrentUser, MembershipSummary, Permission } from "@sci/contracts";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, getTenantId, setTenantId } from "./api";

interface SessionValue {
  user: CurrentUser;
  membership: MembershipSummary | null;
  can: (p: Permission) => boolean;
  switchTenant: (id: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [tenantId, setTenant] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api<CurrentUser>("/auth/me", { tenant: false });
      setUser(me);
      const saved = getTenantId();
      const valid = me.memberships.find((m) => m.tenantId === saved) ?? me.memberships[0] ?? null;
      setTenantId(valid?.tenantId ?? null);
      setTenant(valid?.tenantId ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "Não foi possível conectar ao servidor da plataforma. Verifique sua conexão e tente novamente em instantes.",
        );
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionValue | null>(() => {
    if (!user) return null;
    const membership = user.memberships.find((m) => m.tenantId === tenantId) ?? null;
    return {
      user,
      membership,
      can: (p) => !!membership?.permissions.includes(p),
      switchTenant: (id) => {
        setTenantId(id);
        setTenant(id);
        router.refresh();
      },
      logout: async () => {
        await api("/auth/logout", { method: "POST", tenant: false }).catch(() => undefined);
        setTenantId(null);
        router.replace("/login");
      },
      refresh,
    };
  }, [user, tenantId, router, refresh]);

  if (!value) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center text-sm text-ink-soft">
        {loadError ? (
          <>
            <p className="max-w-md text-risk">{loadError}</p>
            <button
              className="rounded-lg border border-line bg-white px-3 py-2 text-ink"
              onClick={() => {
                setLoadError(null);
                void refresh();
              }}
            >
              Tentar novamente
            </button>
          </>
        ) : (
          "Carregando…"
        )}
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession fora do SessionProvider");
  return v;
}
