"use client";

import { MEETING_TYPE_LABELS, MEETING_TYPES, type Playbook } from "@sci/contracts";
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { VersionStatus } from "@/components/status";
import { Button, Card, Empty, ErrorText, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

export default function PlaybooksPage() {
  const { can } = useSession();
  const { data, error, reload } = useApi<Playbook[]>("/playbooks");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/playbooks", {
        method: "POST",
        json: {
          name: f.get("name"),
          meetingType: f.get("meetingType"),
          description: f.get("description") || null,
          journeyStage: f.get("journeyStage") || null,
          segment: f.get("segment") || null,
          operation: f.get("operation") || null,
        },
      });
      setOpen(false);
      setErr(null);
      await reload();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Playbooks e Conhecimento"
        subtitle="A metodologia da sua empresa, interpretada e usada pelo assistente durante as reuniões."
        actions={
          <div className="flex gap-2">
            <Link href="/app/playbooks/skill">
              <Button variant="ghost">
                <Sparkles size={16} /> Skill de CS
              </Button>
            </Link>
            {can("playbooks.manage") && (
              <Button onClick={() => setOpen((v) => !v)}>
                <Plus size={16} /> Novo playbook
              </Button>
            )}
          </div>
        }
      />
      {open && (
        <Card className="mb-6">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Nome" name="name" required minLength={2} />
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Tipo de reunião</span>
              <select
                name="meetingType"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              >
                {MEETING_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {MEETING_TYPE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <Input label="Etapa da jornada" name="journeyStage" />
            <Input label="Segmento" name="segment" />
            <Input label="Operação" name="operation" />
            <Input label="Descrição" name="description" />
            {err && (
              <div className="sm:col-span-3">
                <ErrorText>{err}</ErrorText>
              </div>
            )}
            <div>
              <Button type="submit">Criar playbook</Button>
            </div>
          </form>
        </Card>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {data?.length === 0 && (
        <Empty title="Nenhum playbook ainda">
          Crie um playbook e envie seus documentos (PDF, DOCX, PPTX, XLSX, TXT ou Markdown) ou cadastre as
          perguntas manualmente.
        </Empty>
      )}
      {data && data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} href={`/app/playbooks/${p.id}`}>
              <Card className={`h-full transition hover:border-brand/40 ${p.active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  <VersionStatus status={p.latestVersionStatus} />
                </div>
                <p className="mt-1 text-sm text-ink-soft">{MEETING_TYPE_LABELS[p.meetingType]}</p>
                <p className="mt-3 text-xs text-ink-soft">
                  {p.publishedVersionNumber
                    ? `Versão publicada: v${p.publishedVersionNumber}`
                    : "Nenhuma versão publicada"}
                  {!p.active && " · Desativado"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
