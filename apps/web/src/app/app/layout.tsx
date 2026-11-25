"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Shield } from "lucide-react";
import { NAV } from "@/lib/navigation";
import { SessionProvider, useSession } from "@/lib/session";

function Shell({ children }: { children: React.ReactNode }) {
  const { user, membership, can, switchTenant, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-white md:flex">
        <div className="px-5 py-5">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-soft">ACADEMIA SCALE</div>
          <div className="text-base font-semibold">Customer Intelligence</div>
        </div>
        {user.memberships.length > 0 && (
          <div className="px-4 pb-3">
            <select
              aria-label="Tenant"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm"
              value={membership?.tenantId ?? ""}
              onChange={(e) => switchTenant(e.target.value)}
            >
              {user.memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.tenantName}
                </option>
              ))}
            </select>
          </div>
        )}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.filter((n) => can(n.permission)).map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                  active
                    ? "bg-brand-soft font-medium text-brand"
                    : "text-ink-soft hover:bg-canvas hover:text-ink"
                }`}
              >
                <n.icon size={16} />
                {n.label}
              </Link>
            );
          })}
          {user.isPlatformAdmin && (
            <Link
              href="/platform"
              className="mt-3 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-soft hover:bg-canvas"
            >
              <Shield size={16} /> Superadmin
            </Link>
          )}
        </nav>
        <div className="border-t border-line p-4">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-ink-soft">{membership?.roleName ?? "Sem tenant"}</div>
          <button
            onClick={() => void logout()}
            className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft hover:text-ink"
          >
            <LogOut size={13} /> Sair
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mb-5 flex gap-2 md:hidden">
          <select
            aria-label="Módulo"
            className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 py-2 text-sm"
            value={NAV.find((n) => pathname.startsWith(n.href))?.href ?? ""}
            onChange={(e) => router.push(e.target.value)}
          >
            {NAV.filter((n) => can(n.permission)).map((n) => (
              <option key={n.href} value={n.href}>
                {n.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void logout()}
            aria-label="Sair"
            className="rounded-lg border border-line bg-white px-3"
          >
            <LogOut size={15} />
          </button>
        </div>
        {membership ? (
          children
        ) : (
          <p className="text-sm text-ink-soft">
            Você ainda não está vinculado a nenhum tenant. Fale com o administrador.
          </p>
        )}
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
