"use client";

import type { MeetingAnalysis } from "@sci/contracts";
import { SeverityBadge, IndicatorTable } from "@/components/health";
import { Button, Card, ErrorText } from "@/components/ui";

const OBJ = {
  met: "Atingido",
  partial: "Parcial",
  not_met: "Não atingido",
  unknown: "Sem evidência",
} as const;
const SENT = { positive: "Positivo", neutral: "Neutro", negative: "Negativo" } as const;

export function AnalysisView({
  a,
  onReanalyze,
  canAct,
}: {
  a: MeetingAnalysis | null;
  onReanalyze: () => void;
  canAct: boolean;
}) {
  if (!a) {
    return (
      <Card className="text-sm text-ink-soft">
        Nenhuma análise ainda. Ela é gerada automaticamente ao encerrar uma reunião com transcrição.
        {canAct && (
          <div className="mt-3">
            <Button onClick={onReanalyze}>Analisar agora</Button>
          </div>
        )}
      </Card>
    );
  }
  if (a.status === "processing") return <Card className="text-sm text-ink-soft">Análise em andamento…</Card>;
  if (a.status === "failed") return <ErrorText>{a.error ?? "A análise falhou."}</ErrorText>;
  const r = a;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
        <span>
          Análise v{a.version} · {a.mode === "full" ? "completa" : "básica"} · skill v{a.skillVersion}
          {a.model ? ` · ${a.model}` : ""} ·{" "}
          {a.completedAt ? new Date(a.completedAt).toLocaleString("pt-BR") : ""}
        </span>
        {canAct && (
          <Button variant="ghost" onClick={onReanalyze}>
            Reanalisar
          </Button>
        )}
      </div>
      {a.warnings.length > 0 && (
        <Card className="border-attention/40 text-sm text-ink-soft">
          <ul className="list-disc space-y-1 pl-5">
            {a.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
      {(a.summary || a.diagnosis) && (
        <Card className="space-y-3">
          {a.summary && (
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-soft">Resumo executivo</div>
              <p className="mt-1">{a.summary}</p>
            </div>
          )}
          {a.diagnosis && (
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-soft">Diagnóstico</div>
              <p className="mt-1">{a.diagnosis}</p>
            </div>
          )}
        </Card>
      )}
      <Card>
        <h3 className="mb-1 font-semibold">Indicadores</h3>
        <p className="mb-2 text-xs text-ink-soft">
          Clique em um indicador para ver a justificativa e os trechos da transcrição.
        </p>
        <IndicatorTable indicators={a.indicators} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {a.objectives.length > 0 && (
          <Card>
            <h3 className="mb-2 font-semibold">Objetivos</h3>
            <ul className="space-y-1 text-sm">
              {a.objectives.map((o, i) => (
                <li key={i}>
                  <span className="font-medium">{OBJ[o.status]}:</span> {o.objective}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {a.unansweredQuestions.length > 0 && (
          <Card>
            <h3 className="mb-2 font-semibold">Perguntas não respondidas</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {a.unansweredQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </Card>
        )}
        {a.needs.length > 0 && (
          <Card>
            <h3 className="mb-2 font-semibold">Necessidades</h3>
            <ul className="space-y-2 text-sm">
              {a.needs.map((n, i) => (
                <li key={i}>
                  <span className="font-medium">{n.category}:</span> {n.description}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {a.feedbacks.length > 0 && (
          <Card>
            <h3 className="mb-2 font-semibold">Feedbacks</h3>
            <ul className="space-y-2 text-sm">
              {a.feedbacks.map((f, i) => (
                <li key={i}>
                  <span className="font-medium">{SENT[f.sentiment]}:</span> {f.text}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {r.risks.length > 0 && (
        <Card>
          <h3 className="mb-2 font-semibold">Riscos identificados</h3>
          <ul className="space-y-3 text-sm">
            {r.risks.map((x) => (
              <li key={x.factorKey}>
                <div className="flex items-center gap-2">
                  <SeverityBadge value={x.severity} />
                  <span className="font-medium">{x.label}</span>
                </div>
                <blockquote className="mt-1 border-l-2 border-risk/40 pl-3 text-ink-soft">
                  “{x.evidence[0]?.text}”
                </blockquote>
                <p className="mt-1">{x.recommendation}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {r.opportunities.length > 0 && (
        <Card>
          <h3 className="mb-2 font-semibold">Oportunidades</h3>
          <ul className="space-y-2 text-sm">
            {r.opportunities.map((o, i) => (
              <li key={i}>
                <span className="font-medium">{o.label}:</span> {o.need}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a.recommendations.length > 0 && (
        <Card>
          <h3 className="mb-2 font-semibold">Recomendações</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {a.recommendations.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
