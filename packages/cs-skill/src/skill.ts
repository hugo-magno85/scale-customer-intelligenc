import { createHash } from "node:crypto";
import { INDICATOR_LABELS, QUESTION_TYPE_LABELS, type TenantSkillSettings } from "@sci/contracts";
import { GUARDRAILS } from "./knowledge/guardrails.js";
import { INDICATOR_KNOWLEDGE } from "./knowledge/indicators.js";
import { COVERAGE_TOPICS, MEETING_TYPE_KNOWLEDGE } from "./knowledge/meeting-types.js";
import { PRINCIPLES } from "./knowledge/principles.js";
import { QUESTION_LIBRARY } from "./knowledge/question-library.js";
import { QUESTION_TYPE_KNOWLEDGE } from "./knowledge/question-types.js";
import { NEED_CATEGORIES, OPPORTUNITY_TYPES, RISK_SIGNALS } from "./knowledge/signals.js";

/**
 * Versão semântica da skill. Regras:
 *  - MAJOR: muda o significado de indicadores/rubricas (análises antigas deixam de ser comparáveis);
 *  - MINOR: novo conhecimento (perguntas, sinais, princípios);
 *  - PATCH: ajustes de texto.
 * Cada análise registra versão + hash do conteúdo usado.
 */
export const SKILL_VERSION = "1.0.0";
export const SKILL_RELEASED_AT = "2026-11-25";
export const SKILL_CHANGELOG = [
  "1.0.0 — Versão inicial: 12 princípios, 8 indicadores com rubricas, 10 sinais de churn, 8 tipos de oportunidade, 12 tipos de pergunta, biblioteca base e regras de prudência.",
];

export const SKILL_KNOWLEDGE = {
  principles: PRINCIPLES,
  indicators: INDICATOR_KNOWLEDGE,
  questionTypes: QUESTION_TYPE_KNOWLEDGE,
  riskSignals: RISK_SIGNALS,
  opportunityTypes: OPPORTUNITY_TYPES,
  needCategories: NEED_CATEGORIES,
  questionLibrary: QUESTION_LIBRARY,
  meetingTypes: MEETING_TYPE_KNOWLEDGE,
  coverageTopics: COVERAGE_TOPICS,
  guardrails: GUARDRAILS,
};

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const SKILL_CONTENT_HASH = createHash("sha256").update(stableStringify(SKILL_KNOWLEDGE)).digest("hex");

export function skillManifest() {
  return {
    version: SKILL_VERSION,
    contentHash: SKILL_CONTENT_HASH,
    releasedAt: SKILL_RELEASED_AT,
    changelog: SKILL_CHANGELOG,
    questionTypes: Object.entries(QUESTION_TYPE_KNOWLEDGE).map(([key, v]) => ({
      key: key as keyof typeof QUESTION_TYPE_LABELS,
      label: QUESTION_TYPE_LABELS[key as keyof typeof QUESTION_TYPE_LABELS],
      description: v.description,
    })),
    indicators: INDICATOR_KNOWLEDGE.map((i) => ({
      key: i.key,
      label: INDICATOR_LABELS[i.key],
      description: i.description,
    })),
    principles: PRINCIPLES.map((p) => ({ key: p.key, title: p.title, description: p.description })),
  };
}

/**
 * Renderiza a Camada 1 (conhecimento especialista) como instruções para o
 * modelo de raciocínio, já considerando as configurações do tenant.
 */
export function renderSkillInstructions(settings: TenantSkillSettings): string {
  const lines: string[] = [];
  lines.push(`# Skill especialista em Customer Success v${SKILL_VERSION}`);
  lines.push(
    "Você é um especialista sênior em Customer Success apoiando um profissional durante e após reuniões com clientes.",
  );
  lines.push("\n## Princípios");
  for (const p of PRINCIPLES) lines.push(`- ${p.title}: ${p.description}`);
  lines.push("\n## Regras obrigatórias");
  for (const g of GUARDRAILS) lines.push(`- ${g}`);
  lines.push("\n## Indicadores (escala 0–4)");
  for (const i of INDICATOR_KNOWLEDGE) {
    lines.push(
      `- ${i.key} (${INDICATOR_LABELS[i.key]}): ${i.description} Escala: ${i.rubric.map((r, n) => `${n}=${r}`).join("; ")}.`,
    );
  }
  lines.push("\n## Sinais de churn");
  for (const s of RISK_SIGNALS)
    lines.push(
      `- ${s.key} (${s.label}, base ${s.baseSeverity}): ${s.description} Investigar: ${s.investigate.join(", ")}.`,
    );
  lines.push("\n## Oportunidades de expansão");
  for (const o of OPPORTUNITY_TYPES)
    lines.push(`- ${o.key} (${o.label}): ${o.description} Pré-condição: ${o.precondition}.`);
  lines.push("\n## Tipos de pergunta habilitados");
  for (const t of settings.enabledQuestionTypes) {
    lines.push(
      `- ${t} (${QUESTION_TYPE_LABELS[t]}): ${QUESTION_TYPE_KNOWLEDGE[t].description} Quando usar: ${QUESTION_TYPE_KNOWLEDGE[t].whenToUse}`,
    );
  }
  const tone = {
    formal: "formal",
    neutral: "profissional e cordial",
    informal: "próximo e informal, sem perder o profissionalismo",
  }[settings.formality];
  lines.push(`\n## Estilo\n- Tom das perguntas: ${tone}.`);
  if (settings.focusIndicators.length) {
    lines.push(
      `- Prioridades estratégicas da empresa: ${settings.focusIndicators.map((i) => INDICATOR_LABELS[i]).join(", ")}.`,
    );
  }
  if (settings.additionalGuidelines.length) {
    lines.push("\n## Orientações adicionais da empresa");
    for (const g of settings.additionalGuidelines) lines.push(`- ${g}`);
  }
  return lines.join("\n");
}
