"use client";

import {
  INDICATOR_LABELS,
  MEETING_TYPE_LABELS,
  type Contact,
  type Customer,
  type HealthSnapshot,
  type Meeting,
} from "@sci/contracts";
import { HealthBadge, HealthLine } from "@/components/health";
import Link from "next/link";
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
  const meetings = useApi<Meeting[]>(`/meetings?customerId=${id}&limit=100`);
  const health = useApi<{ current: HealthSnapshot | null; history: HealthSnapshot[] }>(
    can("analyses.read") ? `/customers/${id}/health` : null,
  );
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
          {health.data?.current?.score != null ? (
            <div className="mt-1 flex items-center gap-3">
              <span className="text-2xl font-semibold tabular-nums">
                {Math.round(health.data.current.score)}
              </span>
              <HealthBadge value={health.data.current.classification} />
            </div>
          ) : (
            <div className="mt-1 text-sm text-ink-soft">
              Calculado após reuniões analisadas com evidência suficiente.
            </div>
          )}
        </Card>
      </div>
      {health.data?.current?.score != null && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-semibold">Fatores do Customer Health</h2>
            <ul className="space-y-1.5 text-sm">
              {health.data.current.factors.map((f) => (
                <li key={f.indicator} className="flex justify-between gap-2">
                  <span>{INDICATOR_LABELS[f.indicator]}</span>
                  <span
                    className={`tabular-nums ${f.direction === "up" ? "text-healthy" : f.direction === "down" ? "text-risk" : "text-ink-soft"}`}
                  >
                    {f.direction === "up" ? "▲" : f.direction === "down" ? "▼" : "•"}{" "}
                    {f.impact > 0 ? "+" : ""}
                    {f.impact} (nota {Math.round(f.score)})
                  </span>
                </li>
              ))}
            </ul>
            {health.data.current.overrides.map((o, i) => (
              <p key={i} className="mt-2 text-xs text-ink-soft">
                {o}
              </p>
            ))}
            {health.data.current.missing.length > 0 && (
              <p className="mt-2 text-xs text-ink-soft">
                Sem evidência: {health.data.current.missing.map((x) => INDICATOR_LABELS[x]).join(", ")}.
              </p>
            )}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Evolução</h2>
            <HealthLine
              points={health.data.history
                .filter((h) => h.score !== null)
                .map((h) => ({ date: h.createdAt, score: h.score! }))}
            />
          </Card>
        </div>
      )}
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
      {meetings.data?.length === 0 && (
        <Empty title="Sem reuniões registradas">
          As reuniões, análises e planos de ação deste cliente aparecerão aqui em ordem cronológica.
        </Empty>
      )}
      {meetings.data && meetings.data.length > 0 && (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {meetings.data.map((m) => (
            <li key={m.id}>
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand" />
              <div className="text-xs text-ink-soft">
                {new Date(m.startedAt ?? m.createdAt).toLocaleString("pt-BR")}
              </div>
              <Link href={`/app/calls/${m.id}`} className="font-medium hover:text-brand">
                {m.title ?? MEETING_TYPE_LABELS[m.meetingType]}
              </Link>
              <div className="text-sm text-ink-soft">
                {m.playbookName ? `Playbook ${m.playbookName} v${m.playbookVersionNumber}` : "Sem playbook"}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
