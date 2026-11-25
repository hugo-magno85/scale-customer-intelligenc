import { MEETING_TYPE_KNOWLEDGE, QUESTION_LIBRARY, COVERAGE_TOPICS, type CoverageTopic } from "@sci/cs-skill";
import type { ChecklistItem } from "@sci/contracts";
import type { BrainContext, Candidate } from "./types.js";

/**
 * Banco de perguntas candidatas: playbook do tenant (prioridade) + biblioteca da skill
 * (cobre lacunas e sinais não previstos no playbook).
 */
export function buildCandidates(ctx: BrainContext): Candidate[] {
  const out: Candidate[] = [];
  const enabled = new Set(ctx.settings.enabledQuestionTypes);
  for (const q of ctx.playbook?.questions ?? []) {
    if (!enabled.has(q.type)) continue;
    out.push({
      key: `pb:${q.key}`,
      text: q.text,
      type: q.type,
      indicator: q.indicator,
      priority: q.priority,
      purpose: q.purpose,
      source: "playbook",
      playbookQuestionKey: q.key,
      signals: [],
      covers: [],
      followUps: q.followUps,
      weight: q.weight,
      required: q.required,
    });
  }
  const playbookTexts = new Set(out.map((c) => normalize(c.text)));
  for (const q of QUESTION_LIBRARY) {
    if (!enabled.has(q.type)) continue;
    if (q.meetingTypes !== "all" && !q.meetingTypes.includes(ctx.meetingType)) continue;
    if (playbookTexts.has(normalize(q.text))) continue;
    out.push({
      key: `lib:${q.key}`,
      text: q.text,
      type: q.type,
      indicator: q.indicator,
      priority: q.priority,
      purpose: q.purpose,
      source: "library",
      playbookQuestionKey: null,
      signals: q.signals,
      covers: q.covers,
      followUps: q.followUps,
      weight: 1,
      required: false,
    });
  }
  return out;
}

/** Checklist "o que ainda precisa ser investigado": perguntas do playbook + tópicos obrigatórios do tipo de reunião. */
export function buildChecklist(ctx: BrainContext): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const q of ctx.playbook?.questions ?? []) {
    items.push({
      key: `pb:${q.key}`,
      label: q.text,
      source: "playbook",
      required: q.required,
      status: "open",
      questionKey: q.key,
    });
  }
  for (const topic of MEETING_TYPE_KNOWLEDGE[ctx.meetingType].mustCover) {
    items.push({
      key: `topic:${topic}`,
      label: COVERAGE_TOPICS[topic as CoverageTopic],
      source: "skill",
      required: true,
      status: "open",
      questionKey: null,
    });
  }
  return items;
}

export function preparationNotes(ctx: BrainContext): string[] {
  const k = MEETING_TYPE_KNOWLEDGE[ctx.meetingType];
  const notes = [`Objetivo deste tipo de reunião: ${k.objective}`];
  if (ctx.objective) notes.push(`Objetivo definido: ${ctx.objective}`);
  if (k.avoid) notes.push(`Evitar: ${k.avoid}`);
  for (const h of ctx.history) notes.push(h);
  for (const g of ctx.playbook?.guidelines ?? []) notes.push(`Playbook: ${g}`);
  if (!ctx.playbook) notes.push("Sem playbook selecionado: as sugestões usam apenas a skill de CS.");
  if (!ctx.customer)
    notes.push("Reunião sem cliente vinculado: o histórico do cliente não será considerado até o vínculo.");
  return notes.slice(0, 12);
}

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
