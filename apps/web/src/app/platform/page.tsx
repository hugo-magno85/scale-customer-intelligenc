"use client";

import type { Tenant } from "@sci/contracts";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function PlatformPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    api<Tenant[]>("/platform/tenants", { tenant: false })
      .then(setTenants)
      .catch((e: Error) => setErr(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api("/platform/tenants", {
        method: "POST",
        tenant: false,
        json: {
          name: f.get("name"),
          slug: f.get("slug"),
          admin: { name: f.get("adminName"), email: f.get("adminEmail"), password: f.get("adminPassword") },
        },
      });
      form.reset();
      setErr(null);
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/app/dashboard" className="text-sm text-ink-soft hover:text-ink">
        ← Voltar
      </Link>
      <PageHeader title="Superadmin · Tenants" subtitle="Administração global da Academia Scale." />
      {err && <ErrorText>{err}</ErrorText>}
      <Card className="mb-6">
        <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Empresa" name="name" required />
          <Input label="Identificador (slug)" name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
          <div />
          <Input label="Nome do administrador" name="adminName" required />
          <Input label="E-mail do administrador" name="adminEmail" type="email" required />
          <Input label="Senha inicial" name="adminPassword" type="password" minLength={12} required />
          <div>
            <Button type="submit">Criar tenant</Button>
          </div>
        </form>
      </Card>
      <Card className="p-0">
        <ul className="divide-y divide-line text-sm">
          {tenants?.map((t) => (
            <li key={t.id} className="flex justify-between px-5 py-3">
              <span className="font-medium">{t.name}</span>
              <span className="text-ink-soft">
                {t.slug} · {t.status === "active" ? "ativo" : "suspenso"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
