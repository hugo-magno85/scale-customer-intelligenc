"use client";

import {
  INDICATOR_LABELS,
  INDICATORS,
  QUESTION_TYPE_LABELS,
  type SkillInfo,
  type TenantSkillSettings,
} from "@sci/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, ErrorText, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

export default function SkillPage() {
  const { can } = useSession();
  const { data, error } = useApi<SkillInfo>("/skill");
  const [s, setS] = useState<TenantSkillSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data || !s) return null;
  const editable = can("skill.configure");
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function save() {
    try {
      await api("/skill/settings", { method: "PUT", json: s });
      setMsg({ ok: true, text: "Configuração salva." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <>
      <Link href="/app/playbooks" className="text-sm text-ink-soft hover:text-ink">
        ← Playbooks
      </Link>
      <PageHeader
        title="Skill especialista em Customer Success"
        subtitle={`Versão ${data.version} · a skill interpreta a situação; o playbook define a metodologia da sua empresa.`}
        actions={editable && <Button onClick={() => void save()}>Salvar configuração</Button>}
      />
      {msg && (
        <div className="mb-4">
          {msg.ok ? <p className="text-sm text-healthy">{msg.text}</p> : <ErrorText>{msg.text}</ErrorText>}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Tipos de pergunta habilitados</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.questionTypes.map((q) => (
              <label key={q.key} className="flex items-start gap-2 text-sm" title={q.description}>
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={s.enabledQuestionTypes.includes(q.key)}
                  onChange={() => setS({ ...s, enabledQuestionTypes: toggle(s.enabledQuestionTypes, q.key) })}
                />
                {QUESTION_TYPE_LABELS[q.key]}
              </label>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Condução</h2>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium">Tom das perguntas</span>
              <select
                disabled={!editable}
                className="w-full rounded-lg border border-line px-3 py-2"
                value={s.formality}
                onChange={(e) =>
                  setS({ ...s, formality: e.target.value as TenantSkillSettings["formality"] })
                }
              >
                <option value="formal">Formal</option>
                <option value="neutral">Profissional e cordial</option>
                <option value="informal">Próximo e informal</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Intervalo mínimo entre sugestões (segundos)</span>
              <input
                disabled={!editable}
                type="number"
                min={10}
                max={600}
                className="w-full rounded-lg border border-line px-3 py-2"
                value={s.suggestionCooldownSeconds}
                onChange={(e) => setS({ ...s, suggestionCooldownSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium">Sugestões alternativas além da principal</span>
              <input
                disabled={!editable}
                type="number"
                min={0}
                max={3}
                className="w-full rounded-lg border border-line px-3 py-2"
                value={s.maxAlternativeSuggestions}
                onChange={(e) => setS({ ...s, maxAlternativeSuggestions: Number(e.target.value) })}
              />
            </label>
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Prioridades estratégicas</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {INDICATORS.map((i) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={s.focusIndicators.includes(i)}
                  onChange={() => setS({ ...s, focusIndicators: toggle(s.focusIndicators, i) })}
                />
                {INDICATOR_LABELS[i]}
              </label>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Orientações adicionais da empresa</h2>
          <textarea
            disabled={!editable}
            rows={6}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            value={s.additionalGuidelines.join("\n")}
            onChange={(e) =>
              setS({ ...s, additionalGuidelines: e.target.value.split("\n").filter((x) => x.trim()) })
            }
            placeholder="Uma orientação por linha"
          />
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Princípios da skill</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.principles.map((p) => (
          <Card key={p.key}>
            <div className="font-medium">{p.title}</div>
            <p className="mt-1 text-sm text-ink-soft">{p.description}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
