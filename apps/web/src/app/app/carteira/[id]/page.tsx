"use client";

import type { Contact, Customer } from "@sci/contracts";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Empty, ErrorText, Input, PageHeader } from "@/components/ui";
import { api, formatBRL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: c, error } = useApi<Customer>(`/customers/${id}`);
  const contacts = useApi<Contact[]>(`/customers/${id}/contacts`);
  const [err, setErr] = useState<string | null>(null);

  async function addContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api(`/customers/${id}/contacts`, {
        method: "POST",
        json: { name: f.get("name"), email: f.get("email") || null, jobTitle: f.get("jobTitle") || null },
      });
      form.reset();
      setErr(null);
      await contacts.reload();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!c) return null;
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={[c.segment, c.ownerName].filter(Boolean).join(" · ") || undefined}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-soft">Receita mensal</div>
          <div className="mt-1 text-xl font-semibold">{formatBRL(c.mrrCents)}</div>
          {c.mrrSource && (
            <div className="text-xs text-ink-soft">
              Fonte: {c.mrrSource === "manual" ? "cadastro manual" : "CRM"}
            </div>
          )}
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-soft">Início do relacionamento</div>
          <div className="mt-1 text-xl font-semibold">
            {c.relationshipStartedAt
              ? new Date(c.relationshipStartedAt + "T00:00:00").toLocaleDateString("pt-BR")
              : "—"}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink-soft">Customer Health</div>
          <div className="mt-1 text-sm text-ink-soft">Calculado após a primeira reunião analisada.</div>
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Contatos</h2>
      {contacts.data?.length === 0 && <Empty title="Nenhum contato cadastrado" />}
      {contacts.data && contacts.data.length > 0 && (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {contacts.data.map((ct) => (
              <li key={ct.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-medium">{ct.name}</span>
                <span className="text-ink-soft">{[ct.jobTitle, ct.email].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {can("customers.manage") && (
        <Card className="mt-4">
          <form onSubmit={addContact} className="grid gap-4 sm:grid-cols-4">
            <Input label="Nome" name="name" required />
            <Input label="E-mail" name="email" type="email" />
            <Input label="Cargo" name="jobTitle" />
            <div className="flex items-end">
              <Button type="submit">Adicionar contato</Button>
            </div>
            {err && (
              <div className="sm:col-span-4">
                <ErrorText>{err}</ErrorText>
              </div>
            )}
          </form>
        </Card>
      )}
      <h2 className="mb-3 mt-8 text-lg font-semibold">Linha do tempo</h2>
      <Empty title="Sem reuniões registradas">
        As reuniões, análises e planos de ação deste cliente aparecerão aqui em ordem cronológica.
      </Empty>
    </>
  );
}
