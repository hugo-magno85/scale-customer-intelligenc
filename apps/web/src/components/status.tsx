import type { PlaybookVersionStatus } from "@sci/contracts";

const MAP: Record<PlaybookVersionStatus, { label: string; cls: string }> = {
  processing: { label: "Processando", cls: "bg-brand-soft text-brand" },
  failed: { label: "Falhou", cls: "bg-risk/10 text-risk" },
  draft: { label: "Rascunho", cls: "bg-canvas text-ink-soft border border-line" },
  in_review: { label: "Em revisão", cls: "bg-attention/10 text-attention" },
  approved: { label: "Aprovada", cls: "bg-healthy/10 text-healthy" },
  published: { label: "Publicada", cls: "bg-healthy text-white" },
  archived: { label: "Arquivada", cls: "bg-canvas text-ink-soft" },
};

export function VersionStatus({ status }: { status: PlaybookVersionStatus | null }) {
  if (!status) return <span className="text-xs text-ink-soft">Sem versões</span>;
  const s = MAP[status];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
  );
}
