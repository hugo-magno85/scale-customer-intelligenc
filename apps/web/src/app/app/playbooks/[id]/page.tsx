"use client";

import { MEETING_TYPE_LABELS, type Playbook, type PlaybookVersion } from "@sci/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FilePlus2, PencilLine, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { VersionStatus } from "@/components/status";
import { Button, Card, Empty, ErrorText, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const ACCEPT = ".pdf,.docx,.pptx,.xlsx,.txt,.md";

export default function PlaybookPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const pb = useApi<Playbook>(`/playbooks/${id}`);
  const versions = useApi<PlaybookVersion[]>(`/playbooks/${id}/versions`);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    setBusy(true);
    setErr(null);
    try {
      const v = await api<PlaybookVersion>(`/playbooks/${id}/versions/upload`, {
        method: "POST",
        body: form,
      });
      router.push(`/app/playbooks/versao/${v.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function manual() {
    try {
      const v = await api<PlaybookVersion>(`/playbooks/${id}/versions/manual`, {
        method: "POST",
        json: {
          structure: {
            questions: [
              {
                key: "pergunta_1",
                text: "Qual é o objetivo principal desta reunião para vocês?",
                type: "diagnosis",
                purpose: "Abrir a reunião alinhando objetivos.",
              },
            ],
          },
        },
      });
      router.push(`/app/playbooks/versao/${v.id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function toggleActive() {
    if (!pb.data) return;
    await api(`/playbooks/${id}`, { method: "PATCH", json: { active: !pb.data.active } }).catch((e: Error) =>
      setErr(e.message),
    );
    await pb.reload();
  }

  if (pb.error) return <ErrorText>{pb.error}</ErrorText>;
  if (!pb.data) return null;
  const p = pb.data;
  return (
    <>
      <Link href="/app/playbooks" className="text-sm text-ink-soft hover:text-ink">
        ← Playbooks
      </Link>
      <PageHeader
        title={p.name}
        subtitle={[MEETING_TYPE_LABELS[p.meetingType], p.journeyStage, p.segment, p.operation]
          .filter(Boolean)
          .join(" · ")}
        actions={
          can("playbooks.manage") && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => void uploadFiles(e.target.files)}
              />
              <Button onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload size={16} /> {busy ? "Enviando e interpretando…" : "Enviar documentos"}
              </Button>
              <Button variant="ghost" onClick={() => void manual()}>
                <PencilLine size={16} /> Cadastro manual
              </Button>
              <Button variant="ghost" onClick={() => void toggleActive()}>
                {p.active ? "Desativar" : "Reativar"}
              </Button>
            </div>
          )
        }
      />
      {p.description && <p className="-mt-3 mb-6 max-w-3xl text-sm text-ink-soft">{p.description}</p>}
      {err && <ErrorText>{err}</ErrorText>}
      <h2 className="mb-3 mt-2 text-lg font-semibold">Versões</h2>
      {versions.data?.length === 0 && (
        <Empty title="Nenhuma versão">
          <FilePlus2 className="mx-auto mb-2" size={20} />
          Envie os documentos do playbook para a IA interpretar, ou faça o cadastro manual.
        </Empty>
      )}
      {versions.data && versions.data.length > 0 && (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {versions.data.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/app/playbooks/versao/${v.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-canvas/60"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-semibold">v{v.number}</span>
                    <VersionStatus status={v.status} />
                    <span className="text-ink-soft">
                      {v.source === "upload" ? `${v.documents.length} documento(s)` : "Cadastro manual"}
                    </span>
                  </span>
                  <span className="text-ink-soft">
                    {v.structure ? `${v.structure.questions.length} perguntas · ` : ""}
                    {new Date(v.createdAt).toLocaleString("pt-BR")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
