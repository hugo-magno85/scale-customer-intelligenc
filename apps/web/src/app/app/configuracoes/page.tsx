"use client";

import {
  INDICATOR_LABELS,
  PERMISSIONS,
  type AuditLogEntry,
  type HealthSettings,
  type Permission,
  type Role,
  type TenantMember,
} from "@sci/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "members" | "roles" | "health" | "audit";

function Members({ roles }: { roles: Role[] }) {
  const { can } = useSession();
  const { data, error, reload } = useApi<TenantMember[]>("/members");
  const [err, setErr] = useState<string | null>(null);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api("/members", {
        method: "POST",
        json: {
          name: f.get("name"),
          email: f.get("email"),
          password: f.get("password") || undefined,
          roleId: f.get("roleId"),
        },
      });
      form.reset();
      setErr(null);
      await reload();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  async function update(userId: string, patch: Record<string, string>) {
    try {
      await api(`/members/${userId}`, { method: "PATCH", json: patch });
      setErr(null);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
    await reload();
  }

  return (
    <div className="space-y-4">
      {(error || err) && <ErrorText>{error ?? err}</ErrorText>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-5 py-3">Nome</th>
              <th className="px-5 py-3">E-mail</th>
              <th className="px-5 py-3">Papel</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((m) => (
              <tr key={m.userId} className="border-b border-line last:border-0">
                <td className="px-5 py-3 font-medium">{m.name}</td>
                <td className="px-5 py-3 text-ink-soft">{m.email}</td>
                <td className="px-5 py-3">
                  <select
                    disabled={!can("users.manage")}
                    value={m.roleId}
                    onChange={(e) => void update(m.userId, { roleId: e.target.value })}
                    className="rounded-md border border-line px-2 py-1"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-3">
                  <select
                    disabled={!can("users.manage")}
                    value={m.status}
                    onChange={(e) => void update(m.userId, { status: e.target.value })}
                    className="rounded-md border border-line px-2 py-1"
                  >
                    <option value="active">Ativo</option>
                    <option value="disabled">Desativado</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {can("users.manage") && (
        <Card>
          <h3 className="mb-3 font-medium">Adicionar usuário</h3>
          <form onSubmit={add} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Input label="Nome" name="name" required />
            <Input label="E-mail" name="email" type="email" required />
            <Input label="Senha inicial (se for novo)" name="password" type="password" minLength={12} />
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Papel</span>
              <select name="roleId" className="w-full rounded-lg border border-line px-3 py-2">
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit">Adicionar</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Roles({ roles, reload }: { roles: Role[]; reload: () => Promise<void> }) {
  const { can } = useSession();
  const [err, setErr] = useState<string | null>(null);
  async function toggle(role: Role, p: Permission) {
    const next = role.permissions.includes(p)
      ? role.permissions.filter((x) => x !== p)
      : [...role.permissions, p];
    try {
      await api(`/roles/${role.id}/permissions`, { method: "PUT", json: { permissions: next } });
      setErr(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Card className="overflow-x-auto p-0">
      {err && (
        <div className="p-4">
          <ErrorText>{err}</ErrorText>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="px-5 py-3">Permissão</th>
            {roles.map((r) => (
              <th key={r.id} className="px-3 py-3 text-center">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((p) => (
            <tr key={p} className="border-b border-line last:border-0">
              <td className="px-5 py-2 font-mono text-xs">{p}</td>
              {roles.map((r) => (
                <td key={r.id} className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${r.name}: ${p}`}
                    checked={r.permissions.includes(p)}
                    disabled={!can("roles.manage") || r.systemKey === "tenant_admin"}
                    onChange={() => void toggle(r, p)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function HealthWeights() {
  const { can } = useSession();
  const { data, error } = useApi<HealthSettings>("/settings/health");
  const [s, setS] = useState<HealthSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (data) setS(data);
  }, [data]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!s) return null;
  const editable = can("tenant.settings.manage");
  const num = (v: string) => Number(v.replace(",", "."));
  async function save() {
    try {
      setS(await api<HealthSettings>("/settings/health", { method: "PUT", json: s }));
      setMsg({ ok: true, text: "Pesos salvos. Valem para as próximas análises." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <Card className="space-y-4">
      <p className="text-sm text-ink-soft">
        O Customer Health é a média ponderada dos indicadores com evidência em cada reunião. Indicadores sem
        evidência ficam de fora e os pesos são redistribuídos. Risco de churn atua como trava da
        classificação.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(s.weights).map(([k, v]) => (
          <Input
            key={k}
            label={`Peso: ${INDICATOR_LABELS[k as keyof typeof INDICATOR_LABELS]}`}
            type="number"
            min={0}
            max={10}
            step={0.5}
            disabled={!editable}
            value={v}
            onChange={(e) => setS({ ...s, weights: { ...s.weights, [k]: num(e.target.value) } })}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Saudável a partir de"
          type="number"
          min={1}
          max={100}
          disabled={!editable}
          value={s.healthyMin}
          onChange={(e) => setS({ ...s, healthyMin: num(e.target.value) })}
        />
        <Input
          label="Atenção a partir de"
          type="number"
          min={0}
          max={99}
          disabled={!editable}
          value={s.attentionMin}
          onChange={(e) => setS({ ...s, attentionMin: num(e.target.value) })}
        />
        <Input
          label="Excelente a partir de (BI)"
          type="number"
          min={1}
          max={100}
          placeholder="padrão: 80"
          disabled={!editable}
          value={s.excellentMin ?? ""}
          onChange={(e) =>
            setS({ ...s, excellentMin: e.target.value === "" ? undefined : num(e.target.value) })
          }
        />
        <Input
          label="Peso do histórico (0–0,9)"
          type="number"
          min={0}
          max={0.9}
          step={0.05}
          disabled={!editable}
          value={s.historyWeight}
          onChange={(e) => setS({ ...s, historyWeight: num(e.target.value) })}
        />
        <Input
          label="Mínimo de indicadores"
          type="number"
          min={1}
          max={6}
          disabled={!editable}
          value={s.minIndicators}
          onChange={(e) => setS({ ...s, minIndicators: num(e.target.value) })}
        />
      </div>
      {msg &&
        (msg.ok ? <p className="text-sm text-healthy">{msg.text}</p> : <ErrorText>{msg.text}</ErrorText>)}
      {editable && <Button onClick={() => void save()}>Salvar pesos</Button>}
    </Card>
  );
}

function Audit() {
  const { data, error } = useApi<AuditLogEntry[]>("/audit-logs?limit=100");
  if (error) return <ErrorText>{error}</ErrorText>;
  return (
    <Card className="p-0">
      <ul className="divide-y divide-line text-sm">
        {data?.map((l) => (
          <li key={l.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
            <span className="font-mono text-xs">{l.action}</span>
            <span className="text-ink-soft">{new Date(l.createdAt).toLocaleString("pt-BR")}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function SettingsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("members");
  const roles = useApi<Role[]>("/roles");
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "members", label: "Usuários", show: true },
    { key: "roles", label: "Papéis e permissões", show: true },
    { key: "health", label: "Customer Health", show: can("analyses.read") },
    { key: "audit", label: "Auditoria", show: can("audit.read") },
  ];
  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Usuários, papéis, permissões e trilha de auditoria do tenant."
      />
      <div className="mb-5 flex gap-1 border-b border-line">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-brand font-medium text-brand" : "border-transparent text-ink-soft"}`}
            >
              {t.label}
            </button>
          ))}
      </div>
      {roles.error && <ErrorText>{roles.error}</ErrorText>}
      {tab === "members" && roles.data && <Members roles={roles.data} />}
      {tab === "roles" && roles.data && <Roles roles={roles.data} reload={roles.reload} />}
      {tab === "health" && <HealthWeights />}
      {tab === "audit" && <Audit />}
    </>
  );
}
