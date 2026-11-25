import { z } from "zod";
import { Uuid } from "./common.js";

/** Os 8 indicadores de Customer Intelligence. */
export const INDICATORS = [
  "satisfaction",
  "trust",
  "engagement",
  "value_perception",
  "adoption",
  "expectation_alignment",
  "churn_risk",
  "expansion_opportunity",
] as const;
export const Indicator = z.enum(INDICATORS);
export type Indicator = z.infer<typeof Indicator>;

export const INDICATOR_LABELS: Record<Indicator, string> = {
  satisfaction: "Satisfação",
  trust: "Confiança",
  engagement: "Engajamento",
  value_perception: "Percepção de valor",
  adoption: "Adoção",
  expectation_alignment: "Alinhamento de expectativas",
  churn_risk: "Risco de churn",
  expansion_opportunity: "Oportunidade de expansão",
};

/** Os 12 tipos de pergunta do assistente. */
export const QUESTION_TYPES = [
  "diagnosis",
  "deepening",
  "validation",
  "needs",
  "value_perception",
  "satisfaction",
  "adoption",
  "expectations",
  "risk",
  "retention",
  "expansion",
  "commitment",
] as const;
export const QuestionType = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof QuestionType>;

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  diagnosis: "Diagnóstico",
  deepening: "Aprofundamento",
  validation: "Validação",
  needs: "Identificação de necessidades",
  value_perception: "Percepção de valor",
  satisfaction: "Satisfação",
  adoption: "Adoção",
  expectations: "Expectativas",
  risk: "Risco",
  retention: "Retenção",
  expansion: "Expansão",
  commitment: "Compromisso e próximos passos",
};

export const MEETING_TYPES = [
  "onboarding",
  "follow_up",
  "results_review",
  "satisfaction",
  "at_risk_recovery",
  "retention",
  "expansion",
  "executive_review",
  "other",
] as const;
export const MeetingType = z.enum(MEETING_TYPES);
export type MeetingType = z.infer<typeof MeetingType>;

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  onboarding: "Onboarding",
  follow_up: "Reunião de acompanhamento",
  results_review: "Revisão de resultados",
  satisfaction: "Reunião de satisfação",
  at_risk_recovery: "Recuperação de cliente em risco",
  retention: "Retenção",
  expansion: "Expansão",
  executive_review: "Revisão executiva",
  other: "Outro",
};

export const Priority = z.enum(["high", "medium", "low"]);
export type Priority = z.infer<typeof Priority>;

const Key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "use letras minúsculas, números, _ ou -");
const Text = (max = 2000) => z.string().trim().min(1).max(max);

export const PlaybookQuestionDef = z.object({
  key: Key,
  text: Text(600),
  type: QuestionType,
  purpose: Text(600),
  indicator: Indicator.nullable().default(null),
  priority: Priority.default("medium"),
  stageKey: Key.nullable().default(null),
  /** Peso relativo (0–10) definido pela empresa. */
  weight: z.number().min(0).max(10).default(1),
  /** Perguntas de aprofundamento sugeridas após a resposta. */
  followUps: z.array(Text(600)).max(10).default([]),
  /** Obrigatória para considerar a reunião completa. */
  required: z.boolean().default(false),
});
export type PlaybookQuestionDef = z.infer<typeof PlaybookQuestionDef>;

export const PlaybookCriterionDef = z.object({
  key: Key,
  name: Text(200),
  description: Text(1000),
  indicator: Indicator.nullable().default(null),
  weight: z.number().min(0).max(10).default(1),
});
export type PlaybookCriterionDef = z.infer<typeof PlaybookCriterionDef>;

export const PlaybookTriggerDef = z.object({
  key: Key,
  /** Situação que dispara a regra, em linguagem natural (ex.: "cliente menciona concorrente"). */
  when: Text(500),
  /** O que o assistente deve fazer. */
  then: Text(800),
  relatedQuestionKeys: z.array(Key).max(20).default([]),
  signal: z.enum(["risk", "opportunity", "need", "info"]).default("info"),
});
export type PlaybookTriggerDef = z.infer<typeof PlaybookTriggerDef>;

export const PlaybookStageDef = z.object({
  key: Key,
  name: Text(200),
  objective: Text(1000),
  expectedOutcome: z.string().trim().max(1000).nullable().default(null),
});
export type PlaybookStageDef = z.infer<typeof PlaybookStageDef>;

/** Estrutura interpretada e revisada de uma versão de playbook. */
export const PlaybookStructure = z
  .object({
    summary: z.string().trim().max(2000).default(""),
    objectives: z.array(Text(500)).max(30).default([]),
    stages: z.array(PlaybookStageDef).max(30).default([]),
    questions: z.array(PlaybookQuestionDef).max(200).default([]),
    criteria: z.array(PlaybookCriterionDef).max(100).default([]),
    triggers: z.array(PlaybookTriggerDef).max(100).default([]),
    guidelines: z.array(Text(800)).max(50).default([]),
    expectedResults: z.array(Text(500)).max(30).default([]),
  })
  .superRefine((s, ctx) => {
    const dup = (arr: { key: string }[], path: string) => {
      const seen = new Set<string>();
      arr.forEach((x, i) => {
        if (seen.has(x.key))
          ctx.addIssue({ code: "custom", path: [path, i, "key"], message: "chave duplicada" });
        seen.add(x.key);
      });
    };
    dup(s.stages, "stages");
    dup(s.questions, "questions");
    dup(s.criteria, "criteria");
    dup(s.triggers, "triggers");
    const stageKeys = new Set(s.stages.map((x) => x.key));
    const qKeys = new Set(s.questions.map((x) => x.key));
    s.questions.forEach((q, i) => {
      if (q.stageKey && !stageKeys.has(q.stageKey))
        ctx.addIssue({ code: "custom", path: ["questions", i, "stageKey"], message: "etapa inexistente" });
    });
    s.triggers.forEach((t, i) =>
      t.relatedQuestionKeys.forEach((k, j) => {
        if (!qKeys.has(k))
          ctx.addIssue({
            code: "custom",
            path: ["triggers", i, "relatedQuestionKeys", j],
            message: "pergunta inexistente",
          });
      }),
    );
  });
export type PlaybookStructure = z.infer<typeof PlaybookStructure>;

export const PlaybookVersionStatus = z.enum([
  "processing",
  "failed",
  "draft",
  "in_review",
  "approved",
  "published",
  "archived",
]);
export type PlaybookVersionStatus = z.infer<typeof PlaybookVersionStatus>;

export const Playbook = z.object({
  id: Uuid,
  name: z.string(),
  description: z.string().nullable(),
  meetingType: MeetingType,
  journeyStage: z.string().nullable(),
  segment: z.string().nullable(),
  operation: z.string().nullable(),
  active: z.boolean(),
  publishedVersionId: Uuid.nullable(),
  publishedVersionNumber: z.number().int().nullable(),
  latestVersionStatus: PlaybookVersionStatus.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Playbook = z.infer<typeof Playbook>;

export const CreatePlaybookRequest = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullish(),
  meetingType: MeetingType,
  journeyStage: z.string().trim().max(120).nullish(),
  segment: z.string().trim().max(120).nullish(),
  operation: z.string().trim().max(120).nullish(),
});
export type CreatePlaybookRequest = z.infer<typeof CreatePlaybookRequest>;

export const UpdatePlaybookRequest = CreatePlaybookRequest.partial().extend({
  active: z.boolean().optional(),
});

export const PlaybookDocumentInfo = z.object({
  id: Uuid,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  extractedChars: z.number().int().nullable(),
  createdAt: z.string(),
});
export type PlaybookDocumentInfo = z.infer<typeof PlaybookDocumentInfo>;

export const PlaybookVersion = z.object({
  id: Uuid,
  playbookId: Uuid,
  number: z.number().int(),
  status: PlaybookVersionStatus,
  source: z.enum(["upload", "manual"]),
  structure: PlaybookStructure.nullable(),
  processingError: z.string().nullable(),
  processingWarnings: z.array(z.string()),
  interpretationModel: z.string().nullable(),
  skillVersion: z.string().nullable(),
  createdBy: Uuid.nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  documents: z.array(PlaybookDocumentInfo),
});
export type PlaybookVersion = z.infer<typeof PlaybookVersion>;

export const CreateManualVersionRequest = z.object({ structure: PlaybookStructure });
export const UpdateVersionStructureRequest = z.object({ structure: PlaybookStructure });

export const SUPPORTED_PLAYBOOK_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/markdown": "md",
};
export const PLAYBOOK_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const PLAYBOOK_MAX_FILES = 10;

/** Configurações da skill de CS que cada tenant pode ajustar. */
export const TenantSkillSettings = z.object({
  enabledQuestionTypes: z
    .array(QuestionType)
    .min(1)
    .default([...QUESTION_TYPES]),
  /** Quantas sugestões alternativas mostrar além da principal. */
  maxAlternativeSuggestions: z.number().int().min(0).max(3).default(2),
  /** Intervalo mínimo entre novas sugestões durante a call. */
  suggestionCooldownSeconds: z.number().int().min(10).max(600).default(45),
  formality: z.enum(["formal", "neutral", "informal"]).default("neutral"),
  /** Prioridades estratégicas da empresa, consideradas no motor de decisão. */
  focusIndicators: z.array(Indicator).max(8).default([]),
  /** Orientações adicionais da empresa (não substituem o playbook). */
  additionalGuidelines: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});
export type TenantSkillSettings = z.infer<typeof TenantSkillSettings>;

export const SkillInfo = z.object({
  version: z.string(),
  contentHash: z.string(),
  releasedAt: z.string(),
  changelog: z.array(z.string()),
  questionTypes: z.array(z.object({ key: QuestionType, label: z.string(), description: z.string() })),
  indicators: z.array(z.object({ key: Indicator, label: z.string(), description: z.string() })),
  principles: z.array(z.object({ key: z.string(), title: z.string(), description: z.string() })),
  settings: TenantSkillSettings,
});
export type SkillInfo = z.infer<typeof SkillInfo>;
