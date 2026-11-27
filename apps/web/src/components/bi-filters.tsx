"use client";

import type { BiCompare, Playbook, ReportFilters, TenantMember } from "@sci/contracts";
import { RotateCcw } from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

export const PRESETS = [
  { key: "current_month", label: "Mês atual" },
  { key: "previous_month", label: "Mês anterior" },
  { key: "same_month_last_year", label: "Mesmo mês do ano anterior" },
  { key: "current_year", label: "Ano atual" },
  { key: "previous_year", label: "Ano anterior" },
  { key: "last_30", label: "Últimos 30 dias" },
  { key: "last_90", label: "Últimos 90 dias" },
  { key: "last_365", label: "Últimos 12 meses" },
  { key: "custom", label: "Período personalizado" },
] as const;
export type Preset = (typeof PRESETS)[number]["key"];

export interface BiState {
  preset: Preset;
  from?: string;
  to?: string;
  compare: BiCompare;
  ownerUserId?: string;
  segment?: string;
  playbookId?: string;
  health?: ReportFilters["health"];
  risk?: ReportFilters["risk"];
}
export const DEFAULT_BI: BiState = { preset: "last_90", compare: "previous" };

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Converte o atalho em datas (fuso local do usuário). */
export function presetRange(
  p: Preset,
  custom?: { from?: string; to?: string },
): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = ymd(now);
  const back = (n: number) => ymd(new Date(y, m, now.getDate() - n));
  switch (p) {
    case "current_month":
      return { from: ymd(new Date(y, m, 1)), to: today };
    case "previous_month":
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "same_month_last_year":
      return { from: ymd(new Date(y - 1, m, 1)), to: ymd(new Date(y - 1, m + 1, 0)) };
    case "current_year":
      return { from: ymd(new Date(y, 0, 1)), to: today };
    case "previous_year":
      return { from: ymd(new Date(y - 1, 0, 1)), to: ymd(new Date(y - 1, 11, 31)) };
    case "last_30":
      return { from: back(29), to: today };
    case "last_365":
      return { from: back(364), to: today };
    case "custom":
      return { from: custom?.from ?? back(89), to: custom?.to ?? today };
    default:
      return { from: back(89), to: today };
  }
}

export function biQuery(s: BiState): string {
  const { from, to } = presetRange(s.preset, s);
  const p = new URLSearchParams({ from, to, compare: s.compare });
  for (const k of ["ownerUserId", "segment", "playbookId", "health", "risk"] as const)
    if (s[k]) p.set(k, String(s[k]));
  return p.toString();
}

/** Quantos filtros além do período estão ativos (contador do botão Filtros). */
export const activeFilterCount = (s: BiState) =>
  [s.compare !== DEFAULT_BI.compare, s.ownerUserId, s.segment, s.playbookId, s.health, s.risk].filter(Boolean)
    .length;

export const isFiltered = (s: BiState) =>
  s.preset !== DEFAULT_BI.preset ||
  s.compare !== DEFAULT_BI.compare ||
  !!(s.ownerUserId || s.segment || s.playbookId || s.health || s.risk);

const sel =
  "h-9 rounded-lg border border-line bg-white/90 px-2.5 text-sm shadow-[0_1px_1px_rgba(15,23,41,0.03)] outline-none transition focus:border-bi-blue focus:ring-2 focus:ring-bi-blue/15";

/** Filtros globais: todos os componentes do BI usam este estado. */
export function BiFilterBar({
  value,
  onChange,
  variant = "bar",
}: {
  value: BiState;
  onChange: (v: BiState) => void;
  /** "panel": painel aberto pelo botão Filtros do dashboard (sem barra fixa). */
  variant?: "bar" | "panel";
}) {
  const { can } = useSession();
  const members = useApi<TenantMember[]>(can("users.read") ? "/members" : null);
  const playbooks = useApi<Playbook[]>(can("playbooks.read") ? "/playbooks" : null);
  const set = (patch: Partial<BiState>) => onChange({ ...value, ...patch });
  const range = presetRange(value.preset, value);
  return (
    <div
      className={
        variant === "panel"
          ? "rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,64,.05),0_8px_24px_-12px_rgba(16,24,64,.14)]"
          : "sticky top-0 z-30 -mx-4 mb-6 border-b border-line/60 bg-canvas/85 px-4 py-3 backdrop-blur md:-mx-10 md:px-10"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={sel}
          aria-label="Período"
          value={value.preset}
          onChange={(e) => {
            const preset = e.target.value as Preset;
            set(preset === "custom" ? { preset, ...presetRange(value.preset, value) } : { preset });
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {value.preset === "custom" && (
          <>
            <input
              type="date"
              className={sel}
              aria-label="De"
              value={range.from}
              max={range.to}
              onChange={(e) => e.target.value && set({ from: e.target.value })}
            />
            <input
              type="date"
              className={sel}
              aria-label="Até"
              value={range.to}
              min={range.from}
              onChange={(e) => e.target.value && set({ to: e.target.value })}
            />
          </>
        )}
        <select
          className={sel}
          aria-label="Comparar com"
          value={value.compare}
          onChange={(e) => set({ compare: e.target.value as BiCompare })}
        >
          <option value="previous">vs. período anterior</option>
          <option value="year">vs. mesmo período do ano anterior</option>
        </select>
        <span className="mx-1 hidden h-6 w-px bg-line md:inline-block" aria-hidden />
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
          key={value.segment ?? "none"}
          className={`${sel} w-36`}
          aria-label="Segmento"
          placeholder="Segmento"
          defaultValue={value.segment ?? ""}
          onBlur={(e) => set({ segment: e.target.value.trim() || undefined })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
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
          aria-label="Saúde do cliente"
          value={value.health ?? ""}
          onChange={(e) => set({ health: (e.target.value || undefined) as BiState["health"] })}
        >
          <option value="">Qualquer saúde</option>
          <option value="healthy">Saudável</option>
          <option value="attention">Atenção</option>
          <option value="high_risk">Risco alto</option>
        </select>
        <select
          className={sel}
          aria-label="Nível de risco"
          value={value.risk ?? ""}
          onChange={(e) => set({ risk: (e.target.value || undefined) as BiState["risk"] })}
        >
          <option value="">Qualquer risco</option>
          <option value="any">Com risco aberto</option>
          <option value="high">Risco alto ou crítico</option>
          <option value="critical">Somente crítico</option>
        </select>
        {isFiltered(value) && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_BI)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink-soft transition hover:bg-white hover:text-ink"
          >
            <RotateCcw size={14} aria-hidden /> Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}
