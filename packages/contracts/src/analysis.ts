import { z } from "zod";
import { Uuid } from "./common.js";
import { HealthClass } from "./customers.js";
import { Indicator, Priority } from "./playbooks.js";

export const QuoteEvidence = z.object({
  segmentId: z.number().int(),
  speaker: z.enum(["internal", "customer"]),
  text: z.string(),
  startMs: z.number().int(),
});
export type QuoteEvidence = z.infer<typeof QuoteEvidence>;

export const IndicatorClass = z.enum(["very_low", "low", "moderate", "high", "very_high"]);

export const IndicatorResult = z.object({
  indicator: Indicator,
  /** 0–100. Nulo quando não há evidência suficiente na reunião. */
  score: z.number().min(0).max(100).nullable(),
  classification: IndicatorClass.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  rationale: z.string(),
  evidence: z.array(QuoteEvidence),
});
export type IndicatorResult = z.infer<typeof IndicatorResult>;

export const Severity = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const MeetingAnalysis = z.object({
  id: Uuid,
  meetingId: Uuid,
  version: z.number().int(),
  status: z.enum(["processing", "completed", "failed"]),
  mode: z.enum(["full", "basic"]).nullable(),
  summary: z.string().nullable(),
  diagnosis: z.string().nullable(),
  objectives: z.array(
    z.object({
      objective: z.string(),
      status: z.enum(["met", "partial", "not_met", "unknown"]),
      evidence: z.array(QuoteEvidence),
    }),
  ),
  questionsAsked: z.array(
    z.object({
      questionKey: z.string().nullable(),
      text: z.string(),
      answered: z.boolean(),
      evidence: z.array(QuoteEvidence),
    }),
  ),
  unansweredQuestions: z.array(z.string()),
  needs: z.array(
    z.object({ category: z.string(), description: z.string(), evidence: z.array(QuoteEvidence) }),
  ),
  feedbacks: z.array(
    z.object({
      sentiment: z.enum(["positive", "neutral", "negative"]),
      text: z.string(),
      evidence: z.array(QuoteEvidence),
    }),
  ),
  recommendations: z.array(z.string()),
  risks: z.array(
    z.object({
      factorKey: z.string(),
      label: z.string(),
      severity: Severity,
      evidence: z.array(QuoteEvidence),
      recommendation: z.string(),
      nextAction: z.string().nullable(),
    }),
  ),
  opportunities: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      need: z.string(),
      evidence: z.array(QuoteEvidence),
      product: z.string().nullable(),
      nextAction: z.string().nullable(),
    }),
  ),
  indicators: z.array(IndicatorResult),
  error: z.string().nullable(),
  warnings: z.array(z.string()),
  model: z.string().nullable(),
  skillVersion: z.string().nullable(),
  playbookVersionId: Uuid.nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type MeetingAnalysis = z.infer<typeof MeetingAnalysis>;

export const HealthFactor = z.object({
  indicator: Indicator,
  score: z.number(),
  weight: z.number(),
  impact: z.number(),
  direction: z.enum(["up", "down", "neutral"]),
});
export const HealthSnapshot = z.object({
  id: Uuid,
  customerId: Uuid,
  meetingId: Uuid.nullable(),
  score: z.number().nullable(),
  classification: HealthClass.nullable(),
  factors: z.array(HealthFactor),
  missing: z.array(Indicator),
  overrides: z.array(z.string()),
  createdAt: z.string(),
});
export type HealthSnapshot = z.infer<typeof HealthSnapshot>;

/** Pesos do Customer Health por tenant. churn_risk e expansion_opportunity não entram na média (risco atua como trava). */
export const HEALTH_INDICATORS = [
  "adoption",
  "engagement",
  "satisfaction",
  "trust",
  "value_perception",
  "expectation_alignment",
] as const;
export const HealthSettings = z
  .object({
    weights: z
      .object(
        Object.fromEntries(HEALTH_INDICATORS.map((k) => [k, z.number().min(0).max(10)])) as Record<
          (typeof HEALTH_INDICATORS)[number],
          z.ZodNumber
        >,
      )
      .default({
        adoption: 2,
        engagement: 1.5,
        satisfaction: 1.5,
        trust: 1.5,
        value_perception: 2,
        expectation_alignment: 1.5,
      }),
    healthyMin: z.number().min(1).max(100).default(70),
    attentionMin: z.number().min(0).max(99).default(40),
    /** Peso do histórico (snapshot anterior) na nova nota, para evitar oscilação por uma reunião. */
    historyWeight: z.number().min(0).max(0.9).default(0.3),
    /** Mínimo de indicadores com evidência para calcular a nota. */
    minIndicators: z.number().int().min(1).max(6).default(3),
  })
  .refine((s) => s.attentionMin < s.healthyMin, {
    message: "faixa de atenção deve ser menor que a de saudável",
  });
export type HealthSettings = z.infer<typeof HealthSettings>;

export const ChurnSignal = z.object({
  id: Uuid,
  customerId: Uuid,
  customerName: z.string(),
  ownerName: z.string().nullable(),
  factorKey: z.string(),
  factorLabel: z.string(),
  severity: Severity,
  recurrence: z.number().int(),
  status: z.enum(["open", "monitoring", "resolved"]),
  evidence: z.array(QuoteEvidence),
  recommendation: z.string(),
  nextAction: z.string().nullable(),
  revenueAtRiskCents: z.number().int().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  lastMeetingId: Uuid.nullable(),
});
export type ChurnSignal = z.infer<typeof ChurnSignal>;

export const ExpansionOpportunity = z.object({
  id: Uuid,
  customerId: Uuid,
  customerName: z.string(),
  meetingId: Uuid.nullable(),
  type: z.string(),
  typeLabel: z.string(),
  need: z.string(),
  evidence: z.array(QuoteEvidence),
  /** Informado por pessoa ou CRM — nunca estimado pelo modelo. */
  potentialCents: z.number().int().nullable(),
  product: z.string().nullable(),
  nextAction: z.string().nullable(),
  ownerUserId: Uuid.nullable(),
  ownerName: z.string().nullable(),
  status: z.enum(["open", "qualified", "won", "lost", "discarded"]),
  createdAt: z.string(),
});
export type ExpansionOpportunity = z.infer<typeof ExpansionOpportunity>;

export const UpdateOpportunityRequest = z.object({
  status: z.enum(["open", "qualified", "won", "lost", "discarded"]).optional(),
  potentialCents: z.number().int().min(0).nullable().optional(),
  product: z.string().trim().max(200).nullable().optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  ownerUserId: Uuid.nullable().optional(),
});

export const TaskStatus = z.enum(["pending", "in_progress", "done", "overdue", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const ActionTask = z.object({
  id: Uuid,
  planId: Uuid.nullable(),
  customerId: Uuid.nullable(),
  customerName: z.string().nullable(),
  meetingId: Uuid.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  ownerUserId: Uuid.nullable(),
  ownerName: z.string().nullable(),
  responsibleParty: z.enum(["internal", "customer"]),
  dueDate: z.string().nullable(),
  priority: Priority,
  /** "overdue" é derivado: prazo vencido e não concluída/cancelada. */
  status: TaskStatus,
  evidence: z.array(QuoteEvidence),
  recommendation: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type ActionTask = z.infer<typeof ActionTask>;

export const CreateTaskRequest = z.object({
  title: z.string().trim().min(2).max(300),
  description: z.string().trim().max(2000).nullish(),
  customerId: Uuid.nullish(),
  meetingId: Uuid.nullish(),
  ownerUserId: Uuid.nullish(),
  dueDate: z.iso.date().nullish(),
  priority: Priority.default("medium"),
});
export const UpdateTaskRequest = z.object({
  title: z.string().trim().min(2).max(300).optional(),
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
  ownerUserId: Uuid.nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  priority: Priority.optional(),
});

export const CustomerHealthRow = z.object({
  customerId: Uuid,
  customerName: z.string(),
  ownerName: z.string().nullable(),
  segment: z.string().nullable(),
  score: z.number().nullable(),
  classification: HealthClass.nullable(),
  trend: z.number().nullable(),
  lastMeetingAt: z.string().nullable(),
  openRisks: z.number().int(),
  mrrCents: z.number().int().nullable(),
});
export type CustomerHealthRow = z.infer<typeof CustomerHealthRow>;
