"use client";

import {
  INDICATOR_LABELS,
  INDICATORS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type PlaybookStructure,
  type PlaybookVersion,
} from "@sci/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { VersionStatus } from "@/components/status";
import { Button, Card, ErrorText, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Q = PlaybookStructure["questions"][number];
const field =
  "w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand";

function Lines({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <textarea
        disabled={disabled}
        rows={Math.max(3, value.length + 1)}
        className={field}
        value={value.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((s) => s.trimStart())
              .filter((s, i, a) => s || i < a.length - 1),
          )
        }
        placeholder="Um item por linha"
      />
    </label>
  );
}

function QuestionEditor({
  q,
  stages,
  onChange,
  onRemove,
  disabled,
}: {
  q: Q;
  stages: PlaybookStructure["stages"];
  onChange: (q: Q) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex gap-2">
        <input
          disabled={disabled}
          className={`${field} font-medium`}
          value={q.text}
          onChange={(e) => onChange({ ...q, text: e.target.value })}
          aria-label="Pergunta"
        />
        {!disabled && (
          <button onClick={onRemove} aria-label="Remover pergunta" className="text-ink-soft hover:text-risk">
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <input
        disabled={disabled}
        className={`${field} mt-2`}
        value={q.purpose}
        onChange={(e) => onChange({ ...q, purpose: e.target.value })}
        aria-label="Objetivo"
        placeholder="Por que perguntar / objetivo"
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <select
          disabled={disabled}
          className={field}
          value={q.type}
          onChange={(e) => onChange({ ...q, type: e.target.value as Q["type"] })}
          aria-label="Tipo"
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {QUESTION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          disabled={disabled}
          className={field}
          value={q.indicator ?? ""}
          onChange={(e) => onChange({ ...q, indicator: (e.target.value || null) as Q["indicator"] })}
          aria-label="Indicador"
        >
          <option value="">Sem indicador</option>
          {INDICATORS.map((i) => (
            <option key={i} value={i}>
              {INDICATOR_LABELS[i]}
            </option>
          ))}
        </select>
        <select
          disabled={disabled}
          className={field}
          value={q.priority}
          onChange={(e) => onChange({ ...q, priority: e.target.value as Q["priority"] })}
          aria-label="Prioridade"
        >
          <option value="high">Prioridade alta</option>
          <option value="medium">Prioridade média</option>
          <option value="low">Prioridade baixa</option>
        </select>
        <select
          disabled={disabled}
          className={field}
          value={q.stageKey ?? ""}
          onChange={(e) => onChange({ ...q, stageKey: e.target.value || null })}
          aria-label="Etapa"
        >
          <option value="">Sem etapa</option>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          Peso
          <input
            disabled={disabled}
            type="number"
            min={0}
            max={10}
            step={0.5}
            className={field}
            value={q.weight}
            onChange={(e) => onChange({ ...q, weight: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            disabled={disabled}
            type="checkbox"
            checked={q.required}
            onChange={(e) => onChange({ ...q, required: e.target.checked })}
          />{" "}
          Obrigatória
        </label>
      </div>
      <div className="mt-2">
        <Lines
          label="Perguntas de aprofundamento"
          value={q.followUps}
          onChange={(v) => onChange({ ...q, followUps: v })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export default function VersionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const { data: v, error, reload } = useApi<PlaybookVersion>(`/playbook-versions/${id}`);
  const [s, setS] = useState<PlaybookStructure | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (v?.structure && !dirty) setS(v.structure);
  }, [v, dirty]);

  useEffect(() => {
    if (v?.status !== "processing") return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [v?.status, reload]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!v) return null;
  const editable = can("playbooks.manage") && (v.status === "draft" || v.status === "in_review");
  const update = (patch: Partial<PlaybookStructure>) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    setDirty(true);
  };

  async function act(path: string, method: "POST" | "PUT" = "POST", json?: unknown) {
    try {
      const r = await api<PlaybookVersion>(`/playbook-versions/${id}/${path}`, { method, json });
      setMsg({ ok: true, text: "Salvo." });
      setDirty(false);
      if (path === "clone") router.push(`/app/playbooks/versao/${r.id}`);
      else await reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <>
      <Link href={`/app/playbooks/${v.playbookId}`} className="text-sm text-ink-soft hover:text-ink">
        ← Playbook
      </Link>
      <PageHeader
        title={`Versão ${v.number}`}
        subtitle={[
          v.source === "upload" ? "Interpretada a partir de documentos" : "Cadastro manual",
          v.skillVersion ? `Skill de CS v${v.skillVersion}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <VersionStatus status={v.status} />
            {editable && dirty && s && (
              <Button onClick={() => void act("structure", "PUT", { structure: s })}>
                Salvar alterações
              </Button>
            )}
            {editable && !dirty && v.status === "draft" && (
              <Button onClick={() => void act("submit")}>Enviar para revisão</Button>
            )}
            {can("playbooks.approve") && !dirty && v.status === "in_review" && (
              <Button onClick={() => void act("approve")}>Aprovar</Button>
            )}
            {can("playbooks.approve") && !dirty && (v.status === "in_review" || v.status === "approved") && (
              <Button variant="ghost" onClick={() => void act("reject")}>
                Devolver para rascunho
              </Button>
            )}
            {can("playbooks.approve") && v.status === "approved" && (
              <Button onClick={() => void act("publish")}>Publicar</Button>
            )}
            {can("playbooks.manage") &&
              v.structure &&
              ["published", "archived", "approved"].includes(v.status) && (
                <Button variant="ghost" onClick={() => void act("clone")}>
                  Criar nova versão a partir desta
                </Button>
              )}
            {can("playbooks.manage") && v.status === "failed" && v.source === "upload" && (
              <Button onClick={() => void act("reprocess")}>Reprocessar</Button>
            )}
          </div>
        }
      />
      {msg && (
        <div className="mb-4">
          {msg.ok ? <p className="text-sm text-healthy">{msg.text}</p> : <ErrorText>{msg.text}</ErrorText>}
        </div>
      )}
      {v.status === "processing" && (
        <Card className="mb-4 text-sm text-ink-soft">
          Extraindo o texto e interpretando o playbook com a IA… esta página atualiza sozinha.
        </Card>
      )}
      {v.processingError && (
        <div className="mb-4">
          <ErrorText>{v.processingError}</ErrorText>
        </div>
      )}
      {v.processingWarnings.length > 0 && (
        <Card className="mb-4 border-attention/40">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-attention">
            <AlertTriangle size={16} /> Pontos para revisar
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {v.processingWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}
      {v.documents.length > 0 && (
        <p className="mb-4 text-xs text-ink-soft">
          Documentos:{" "}
          {v.documents.map((d) => `${d.filename} (${Math.ceil(d.sizeBytes / 1024)} KB)`).join(", ")}
        </p>
      )}
      {s && (
        <div className="space-y-6">
          <Card>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Resumo</span>
              <textarea
                disabled={!editable}
                rows={3}
                className={field}
                value={s.summary}
                onChange={(e) => update({ summary: e.target.value })}
              />
            </label>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Lines
                label="Objetivos"
                value={s.objectives}
                onChange={(x) => update({ objectives: x })}
                disabled={!editable}
              />
              <Lines
                label="Orientações"
                value={s.guidelines}
                onChange={(x) => update({ guidelines: x })}
                disabled={!editable}
              />
              <Lines
                label="Resultados esperados"
                value={s.expectedResults}
                onChange={(x) => update({ expectedResults: x })}
                disabled={!editable}
              />
            </div>
          </Card>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Etapas ({s.stages.length})</h2>
            <div className="space-y-2">
              {s.stages.map((st, i) => (
                <div key={i} className="grid gap-2 rounded-xl border border-line bg-white p-3 md:grid-cols-3">
                  <input
                    disabled={!editable}
                    className={field}
                    value={st.name}
                    onChange={(e) =>
                      update({
                        stages: s.stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      })
                    }
                    aria-label="Nome da etapa"
                  />
                  <input
                    disabled={!editable}
                    className={`${field} md:col-span-2`}
                    value={st.objective}
                    onChange={(e) =>
                      update({
                        stages: s.stages.map((x, j) => (j === i ? { ...x, objective: e.target.value } : x)),
                      })
                    }
                    aria-label="Objetivo da etapa"
                  />
                </div>
              ))}
              {editable && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    update({
                      stages: [
                        ...s.stages,
                        {
                          key: `etapa_${Date.now().toString(36)}`,
                          name: "Nova etapa",
                          objective: "Objetivo da etapa",
                          expectedOutcome: null,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} /> Etapa
                </Button>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Perguntas ({s.questions.length})</h2>
            <div className="space-y-3">
              {s.questions.map((q, i) => (
                <QuestionEditor
                  key={q.key}
                  q={q}
                  stages={s.stages}
                  disabled={!editable}
                  onChange={(nq) => update({ questions: s.questions.map((x, j) => (j === i ? nq : x)) })}
                  onRemove={() => update({ questions: s.questions.filter((_, j) => j !== i) })}
                />
              ))}
              {editable && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    update({
                      questions: [
                        ...s.questions,
                        {
                          key: `pergunta_${Date.now().toString(36)}`,
                          text: "Nova pergunta?",
                          type: "diagnosis",
                          purpose: "Objetivo da pergunta",
                          indicator: null,
                          priority: "medium",
                          stageKey: null,
                          weight: 1,
                          followUps: [],
                          required: false,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} /> Pergunta
                </Button>
              )}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 text-lg font-semibold">Critérios ({s.criteria.length})</h2>
              <div className="space-y-2">
                {s.criteria.map((c, i) => (
                  <div key={c.key} className="rounded-xl border border-line bg-white p-3">
                    <input
                      disabled={!editable}
                      className={`${field} font-medium`}
                      value={c.name}
                      onChange={(e) =>
                        update({
                          criteria: s.criteria.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        })
                      }
                      aria-label="Critério"
                    />
                    <input
                      disabled={!editable}
                      className={`${field} mt-2`}
                      value={c.description}
                      onChange={(e) =>
                        update({
                          criteria: s.criteria.map((x, j) =>
                            j === i ? { ...x, description: e.target.value } : x,
                          ),
                        })
                      }
                      aria-label="Descrição"
                    />
                    <div className="mt-2 flex gap-2">
                      <select
                        disabled={!editable}
                        className={field}
                        value={c.indicator ?? ""}
                        onChange={(e) =>
                          update({
                            criteria: s.criteria.map((x, j) =>
                              j === i
                                ? { ...x, indicator: (e.target.value || null) as typeof c.indicator }
                                : x,
                            ),
                          })
                        }
                        aria-label="Indicador"
                      >
                        <option value="">Sem indicador</option>
                        {INDICATORS.map((ind) => (
                          <option key={ind} value={ind}>
                            {INDICATOR_LABELS[ind]}
                          </option>
                        ))}
                      </select>
                      <input
                        disabled={!editable}
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        className={`${field} w-24`}
                        value={c.weight}
                        onChange={(e) =>
                          update({
                            criteria: s.criteria.map((x, j) =>
                              j === i ? { ...x, weight: Number(e.target.value) } : x,
                            ),
                          })
                        }
                        aria-label="Peso"
                      />
                    </div>
                  </div>
                ))}
                {editable && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      update({
                        criteria: [
                          ...s.criteria,
                          {
                            key: `criterio_${Date.now().toString(36)}`,
                            name: "Novo critério",
                            description: "Descrição",
                            indicator: null,
                            weight: 1,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> Critério
                  </Button>
                )}
              </div>
            </div>
            <div>
              <h2 className="mb-3 text-lg font-semibold">Gatilhos e regras ({s.triggers.length})</h2>
              <div className="space-y-2">
                {s.triggers.map((t, i) => (
                  <div key={t.key} className="rounded-xl border border-line bg-white p-3">
                    <input
                      disabled={!editable}
                      className={field}
                      value={t.when}
                      onChange={(e) =>
                        update({
                          triggers: s.triggers.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)),
                        })
                      }
                      aria-label="Quando"
                      placeholder="Quando…"
                    />
                    <input
                      disabled={!editable}
                      className={`${field} mt-2`}
                      value={t.then}
                      onChange={(e) =>
                        update({
                          triggers: s.triggers.map((x, j) => (j === i ? { ...x, then: e.target.value } : x)),
                        })
                      }
                      aria-label="Então"
                      placeholder="Então…"
                    />
                  </div>
                ))}
                {editable && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      update({
                        triggers: [
                          ...s.triggers,
                          {
                            key: `gatilho_${Date.now().toString(36)}`,
                            when: "Quando o cliente…",
                            then: "O assistente deve…",
                            relatedQuestionKeys: [],
                            signal: "info",
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> Gatilho
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
