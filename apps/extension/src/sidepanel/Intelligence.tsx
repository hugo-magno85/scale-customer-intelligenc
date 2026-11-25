import {
  INDICATOR_LABELS,
  QUESTION_TYPE_LABELS,
  type MeetingIntelligence,
  type PlaybookVersion,
  type Suggestion,
} from "@sci/contracts";
import { useState } from "react";
import { api } from "./api.js";

const PRIORITY = { high: "Alta", medium: "Média", low: "Baixa" } as const;

/**
 * INTELIGÊNCIA EM TEMPO REAL — a informação mais importante durante a reunião:
 * a pergunta recomendada e por que fazê-la. O profissional decide e conduz.
 */
export function IntelligencePanel({
  meetingId,
  playbookVersionId,
  state,
  setState,
  canAct,
}: {
  meetingId: string;
  playbookVersionId: string | null;
  state: MeetingIntelligence | null;
  setState: (s: MeetingIntelligence) => void;
  canAct: boolean;
}) {
  const [view, setView] = useState<"none" | "open" | "playbook" | "note" | "prep">("none");
  const [note, setNote] = useState("");
  const [playbook, setPlaybook] = useState<PlaybookVersion | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!state) return <div className="card muted">Carregando inteligência…</div>;
  const s: Suggestion | null = state.current;

  async function act(path: string) {
    setBusy(true);
    try {
      setState(await api<MeetingIntelligence>(`/meetings/${meetingId}/${path}`, { json: {} }));
      setMsg(null);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!note.trim()) return;
    try {
      await api(`/meetings/${meetingId}/notes`, {
        json: { text: note.trim(), ...(s ? { suggestionId: s.id } : {}) },
      });
      setNote("");
      setView("none");
      setMsg("Observação registrada.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function openPlaybook() {
    setView(view === "playbook" ? "none" : "playbook");
    if (!playbook && playbookVersionId)
      setPlaybook(await api<PlaybookVersion>(`/playbook-versions/${playbookVersionId}`).catch(() => null));
  }

  const open = state.checklist.filter((c) => c.status !== "covered");
  return (
    <>
      <div className="card stack suggestion" aria-live="polite">
        <div className="row between">
          <div className="brand">INTELIGÊNCIA EM TEMPO REAL</div>
          {s && (
            <span className={`pill ${s.priority === "high" ? "live" : ""}`}>
              Prioridade {PRIORITY[s.priority].toLowerCase()}
            </span>
          )}
        </div>
        {s ? (
          <>
            <div className="q">{s.question}</div>
            <dl className="kv">
              <dt>Por que perguntar</dt>
              <dd>{s.reason}</dd>
              <dt>Objetivo</dt>
              <dd>{s.objective}</dd>
              <dt>Indicador</dt>
              <dd>{s.indicator ? INDICATOR_LABELS[s.indicator] : "—"}</dd>
              <dt>Tipo</dt>
              <dd>{QUESTION_TYPE_LABELS[s.type]}</dd>
              {s.playbookRef && (
                <>
                  <dt>Playbook</dt>
                  <dd>Pergunta prevista no playbook</dd>
                </>
              )}
              {s.evidence?.text && (
                <>
                  <dt>Evidência</dt>
                  <dd>“{s.evidence.text}”</dd>
                </>
              )}
            </dl>
            {canAct && (
              <div className="chips">
                <button className="btn" disabled={busy} onClick={() => void act(`suggestions/${s.id}/done`)}>
                  Marcar como realizada
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void act(`suggestions/${s.id}/ignore`)}
                >
                  Ignorar
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => void act("suggestions/next")}>
                  Outra pergunta
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Nenhuma pergunta pendente no momento.</p>
        )}
        <div className="chips">
          {canAct && (
            <button className="btn ghost" onClick={() => setView(view === "note" ? "none" : "note")}>
              Registrar observação
            </button>
          )}
          <button className="btn ghost" onClick={() => setView(view === "open" ? "none" : "open")}>
            Não investigado ({open.length})
          </button>
          {playbookVersionId && (
            <button className="btn ghost" onClick={() => void openPlaybook()}>
              Consultar playbook
            </button>
          )}
          <button className="btn ghost" onClick={() => setView(view === "prep" ? "none" : "prep")}>
            Preparação
          </button>
        </div>
        {msg && <p className="muted">{msg}</p>}
        {view === "note" && (
          <div className="stack">
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="O que vale registrar desta conversa?"
            />
            <button className="btn" onClick={() => void saveNote()}>
              Salvar observação
            </button>
          </div>
        )}
        {view === "open" && (
          <ul className="stack" style={{ margin: 0, paddingLeft: 16 }}>
            {open.map((c) => (
              <li key={c.key}>
                {c.label} {c.status === "partial" && <span className="muted">(parcial)</span>}
                {c.required && <span className="muted"> · obrigatório</span>}
              </li>
            ))}
            {!open.length && <li className="muted">Tudo o que estava previsto foi tratado.</li>}
          </ul>
        )}
        {view === "playbook" && (
          <div className="stack">
            {!playbook && <p className="muted">Carregando playbook…</p>}
            {playbook?.structure?.questions.map((q) => (
              <div key={q.key} className="seg">
                <b>{QUESTION_TYPE_LABELS[q.type]}</b>
                {q.text}
              </div>
            ))}
            {playbook?.structure?.guidelines.map((g, i) => (
              <p key={i} className="muted">
                • {g}
              </p>
            ))}
          </div>
        )}
        {view === "prep" && (
          <ul className="stack" style={{ margin: 0, paddingLeft: 16 }}>
            {state.preparationNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      {state.signals.length > 0 && (
        <div className="card stack">
          <div className="brand">SINAIS IDENTIFICADOS</div>
          {state.signals.map((g) => (
            <div key={g.id} className={`seg ${g.kind === "risk" ? "customer" : ""}`}>
              <b>
                {g.kind === "risk" ? "Risco" : g.kind === "opportunity" ? "Oportunidade" : "Necessidade"} ·{" "}
                {g.label} · {Math.round(g.confidence * 100)}%
              </b>
              {g.evidence.text ? `“${g.evidence.text}”` : ""}
            </div>
          ))}
        </div>
      )}
      {state.alternatives.length > 0 && (
        <details className="card">
          <summary className="muted">Outras perguntas possíveis ({state.alternatives.length})</summary>
          <ul style={{ paddingLeft: 16 }}>
            {state.alternatives.map((a) => (
              <li key={a.id}>{a.question}</li>
            ))}
          </ul>
        </details>
      )}
      {state.degraded.length > 0 && <p className="muted">{state.degraded.join(" ")}</p>}
    </>
  );
}
