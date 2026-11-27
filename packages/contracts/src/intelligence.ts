import { z } from "zod";
import { Uuid } from "./common.js";
import { Indicator, Priority, QuestionType } from "./playbooks.js";

export const SignalKind = z.enum(["risk", "opportunity", "need"]);
export type SignalKind = z.infer<typeof SignalKind>;

export const Evidence = z.object({
  segmentId: z.number().int().nullable(),
  speaker: z.enum(["internal", "customer"]).nullable(),
  text: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

export const LiveSignal = z.object({
  id: Uuid,
  kind: SignalKind,
  key: z.string(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: Evidence,
  /** "ai": motor de decisão da plataforma; "heuristic": palavras-chave. */
  source: z.enum(["ai", "heuristic"]),
  createdAt: z.string(),
});
export type LiveSignal = z.infer<typeof LiveSignal>;

export const SuggestionStatus = z.enum(["shown", "done", "ignored", "replaced"]);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

/** Uma pergunta recomendada — tudo o que a interface em tempo real precisa exibir. */
export const Suggestion = z.object({
  id: Uuid,
  question: z.string(),
  reason: z.string(),
  objective: z.string(),
  type: QuestionType,
  indicator: Indicator.nullable(),
  priority: Priority,
  playbookRef: z.object({ questionKey: z.string(), text: z.string() }).nullable(),
  evidence: Evidence.nullable(),
  candidateKey: z.string(),
  status: SuggestionStatus,
  adaptedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const ChecklistItem = z.object({
  key: z.string(),
  label: z.string(),
  source: z.enum(["playbook", "skill"]),
  required: z.boolean(),
  status: z.enum(["open", "partial", "covered"]),
  questionKey: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const MeetingIntelligence = z.object({
  meetingId: Uuid,
  mode: z.enum(["preparation", "copilot", "ended"]),
  current: Suggestion.nullable(),
  alternatives: z.array(Suggestion),
  checklist: z.array(ChecklistItem),
  signals: z.array(LiveSignal),
  /** Pontos a investigar levantados na preparação (histórico, playbook, tipo de reunião). */
  preparationNotes: z.array(z.string()),
  degraded: z.array(z.string()),
});
export type MeetingIntelligence = z.infer<typeof MeetingIntelligence>;

export const SuggestionAction = z.object({ note: z.string().trim().max(1000).optional() });
export const MeetingNoteRequest = z.object({
  text: z.string().trim().min(1).max(2000),
  suggestionId: Uuid.optional(),
});
