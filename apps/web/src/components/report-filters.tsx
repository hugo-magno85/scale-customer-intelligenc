"use client";

import type { Playbook, ReportFilters, TenantMember } from "@sci/contracts";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const PERIODS = [
  { days: 30, label: "Últimos 30 dias" },
  { days: 90, label: "Últimos 90 dias" },
  { days: 180, label: "Últimos 6 meses" },
  { days: 365, label: "Último ano" },
];

export function toQuery(f: ReportFilters & { days?: number }): string {
  const p = new URLSearchParams();
  if (f.days) p.set("from", new Date(Date.now() - f.days * 86400_000).toISOString().slice(0, 10));
  for (const k of ["ownerUserId", "segment", "playbookId", "health", "risk"] as const)
    if (f[k]) p.set(k, String(f[k]));
  return p.toString();
}

const sel = "rounded-lg border border-line bg-white px-2.5 py-2 text-sm";

/** Filtros em uma única linha, acima dos gráficos. */
export function ReportFilterBar({
  value,
  onChange,
}: {
  value: ReportFilters & { days?: number };
  onChange: (v: ReportFilters & { days?: number }) => void;
}) {
  const { can } = useSession();
  const members = useApi<TenantMember[]>(can("users.read") ? "/members" : null);
  const playbooks = useApi<Playbook[]>(can("playbooks.read") ? "/playbooks" : null);
  const set = (patch: Partial<ReportFilters & { days?: number }>) => onChange({ ...value, ...patch });
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <select
        className={sel}
        aria-label="Período"
        value={value.days ?? 90}
        onChange={(e) => set({ days: Number(e.target.value) })}
      >
        {PERIODS.map((p) => (
          <option key={p.days} value={p.days}>
            {p.label}
          </option>
        ))}
      </select>
      {members.data && (
        <select
          className={sel}
          aria-label="Responsável"
          value={value.ownerUserId ?? ""}
          onChange={(e) => set({ ownerUserId: e.target.value || undefined })}
        >
          <option value="">Todos os responsáveis</option>
          {members.data.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      <input
        className={`${sel} w-40`}
        aria-label="Segmento"
        placeholder="Segmento"
        defaultValue={value.segment ?? ""}
        onBlur={(e) => set({ segment: e.target.value.trim() || undefined })}
      />
      {playbooks.data && (
        <select
          className={sel}
          aria-label="Playbook"
          value={value.playbookId ?? ""}
          onChange={(e) => set({ playbookId: e.target.value || undefined })}
        >
          <option value="">Todos os playbooks</option>
          {playbooks.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <select
        className={sel}
        aria-label="Customer Health"
        value={value.health ?? ""}
        onChange={(e) => set({ health: (e.target.value || undefined) as ReportFilters["health"] })}
      >
        <option value="">Qualquer saúde</option>
        <option value="healthy">Saudável</option>
        <option value="attention">Atenção</option>
        <option value="high_risk">Risco alto</option>
      </select>
      <select
        className={sel}
        aria-label="Risco"
        value={value.risk ?? ""}
        onChange={(e) => set({ risk: (e.target.value || undefined) as ReportFilters["risk"] })}
      >
        <option value="">Qualquer risco</option>
        <option value="any">Com risco aberto</option>
        <option value="high">Risco alto ou crítico</option>
        <option value="critical">Somente crítico</option>
      </select>
    </div>
  );
}
