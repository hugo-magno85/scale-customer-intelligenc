"use client";

import type { ActionTask, TaskStatus } from "@sci/contracts";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Card, Empty, ErrorText, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const STATUS: Record<TaskStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  done: "Concluído",
  overdue: "Atrasado",
  cancelled: "Cancelado",
};
const PRIORITY = { high: "Alta", medium: "Média", low: "Baixa" } as const;

export default function PlansPage() {
  const { can } = useSession();
  const [filter, setFilter] = useState<TaskStatus | "">("");
  const { data, error, reload } = useApi<ActionTask[]>(`/tasks${filter ? `?status=${filter}` : ""}`);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/tasks/${id}`, { method: "PATCH", json: { status } });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api("/tasks", {
        method: "POST",
        json: { title: f.get("title"), dueDate: f.get("due") || null, priority: f.get("priority") },
      });
      form.reset();
      await reload();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Tarefas"
        subtitle="Tarefas geradas pelas análises das reuniões, com evidência e recomendação."
        actions={
          <select
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as TaskStatus | "")}
            aria-label="Filtrar status"
          >
            <option value="">Todas</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      />
      {(error || err) && <ErrorText>{error ?? err}</ErrorText>}
      {can("action_plans.manage") && (
        <Card className="mb-4">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Input label="Nova tarefa" name="title" required minLength={2} />
            </div>
            <Input label="Prazo" name="due" type="date" />
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Prioridade</span>
              <select
                name="priority"
                defaultValue="medium"
                className="w-full rounded-lg border border-line px-3 py-2"
              >
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </label>
            <div>
              <Button type="submit">Adicionar</Button>
            </div>
          </form>
        </Card>
      )}
      {data?.length === 0 && <Empty title="Nenhuma tarefa neste filtro" />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-5 py-3">Tarefa</th>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Responsável</th>
                <th className="px-5 py-3">Prazo</th>
                <th className="px-5 py-3">Prioridade</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="border-b border-line align-top last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium">{t.title}</div>
                    {t.recommendation && <div className="text-xs text-ink-soft">{t.recommendation}</div>}
                    {t.evidence[0] && (
                      <div className="mt-1 text-xs italic text-ink-soft">“{t.evidence[0].text}”</div>
                    )}
                    {t.meetingId && (
                      <Link href={`/app/calls/${t.meetingId}`} className="text-xs text-brand">
                        reunião
                      </Link>
                    )}
                  </td>
                  <td className="px-5 py-3">{t.customerName ?? "—"}</td>
                  <td className="px-5 py-3">
                    {t.responsibleParty === "customer" ? "Cliente" : (t.ownerName ?? "—")}
                  </td>
                  <td
                    className={`px-5 py-3 tabular-nums ${t.status === "overdue" ? "font-medium text-risk" : ""}`}
                  >
                    {t.dueDate ? new Date(t.dueDate + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-5 py-3">{PRIORITY[t.priority]}</td>
                  <td className="px-5 py-3">
                    {can("action_plans.manage") ? (
                      <select
                        className="rounded-md border border-line px-2 py-1"
                        value={t.status === "overdue" ? "pending" : t.status}
                        onChange={(e) => void setStatus(t.id, e.target.value)}
                        aria-label="Status da tarefa"
                      >
                        <option value="pending">{t.status === "overdue" ? "Atrasado" : "Pendente"}</option>
                        <option value="in_progress">Em andamento</option>
                        <option value="done">Concluído</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    ) : (
                      STATUS[t.status]
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
