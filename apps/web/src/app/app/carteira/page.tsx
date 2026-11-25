"use client";

import type { Customer } from "@sci/contracts";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Card, Empty, ErrorText, Input, PageHeader } from "@/components/ui";
import { api, formatBRL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

export default function CarteiraPage() {
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, error, reload } = useApi<{ items: Customer[]; total: number }>(
    `/customers?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const mrr = String(f.get("mrr") ?? "").replace(",", ".");
    try {
      await api("/customers", {
        method: "POST",
        json: {
          name: f.get("name"),
          segment: f.get("segment") || null,
          relationshipStartedAt: f.get("since") || null,
          mrrCents: mrr ? Math.round(Number(mrr) * 100) : null,
        },
      });
      setCreating(false);
      setFormError(null);
      await reload();
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Carteira de Clientes"
        subtitle={data ? `${data.total} cliente(s)` : undefined}
        actions={
          can("customers.manage") && (
            <Button onClick={() => setCreating((v) => !v)}>
              <Plus size={16} /> Novo cliente
            </Button>
          )
        }
      />
      {creating && (
        <Card className="mb-6">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Empresa" name="name" required />
            <Input label="Segmento" name="segment" />
            <Input label="Início do relacionamento" name="since" type="date" />
            <Input label="Receita mensal (R$), se conhecida" name="mrr" inputMode="decimal" />
            {formError && (
              <div className="sm:col-span-2 lg:col-span-4">
                <ErrorText>{formError}</ErrorText>
              </div>
            )}
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit">Salvar cliente</Button>
            </div>
          </form>
        </Card>
      )}
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-2.5 text-ink-soft" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome"
          className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
        />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {data && data.items.length === 0 && (
        <Empty title="Nenhum cliente ainda">
          Cadastre clientes aqui. A importação a partir do CRM chega com o CRM Integration Hub.
        </Empty>
      )}
      {data && data.items.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-5 py-3 font-medium">Empresa</th>
                <th className="px-5 py-3 font-medium">Segmento</th>
                <th className="px-5 py-3 font-medium">Responsável</th>
                <th className="px-5 py-3 font-medium">Receita mensal</th>
                <th className="px-5 py-3 font-medium">Customer Health</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/app/carteira/${c.id}`} className="hover:text-brand">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{c.segment ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{c.ownerName ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{formatBRL(c.mrrCents)}</td>
                  <td className="px-5 py-3 text-ink-soft">Sem análises</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
