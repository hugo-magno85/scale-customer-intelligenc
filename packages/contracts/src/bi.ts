import { z } from "zod";
import { Uuid } from "./common.js";
import { HealthClass } from "./customers.js";
import { ReportFilters } from "./reports.js";

/**
 * BI Executivo. Regras de integridade:
 *  - `null` = indisponível (sem dado ou sem histórico); nunca é trocado por zero;
 *  - comparativos só entre períodos de mesmo tamanho e apenas quando há histórico real;
 *  - valores "como estavam em uma data" vêm do último snapshot de Customer Health até aquela data.
 */
export const BiCompare = z.enum(["previous", "year"]);
export type BiCompare = z.infer<typeof BiCompare>;

export const BiFilters = ReportFilters.extend({ compare: BiCompare.default("previous") });
export type BiFilters = z.infer<typeof BiFilters>;

/** Como ler a variação: para alguns indicadores, cair é bom (ex.: clientes em risco). */
export const BiDirection = z.enum(["up_is_good", "down_is_good", "neutral"]);

export const BiComparison = z.object({
  previous: z.number().nullable(),
  delta: z.number().nullable(),
  deltaPct: z.number().nullable(),
  /** ok | sem histórico no período de comparação | comparação não se aplica a este indicador */
  status: z.enum(["ok", "no_history", "not_applicable"]),
  note: z.string().nullable(),
});
export type BiComparison = z.infer<typeof BiComparison>;

export const BI_KPI_KEYS = [
  "active_customers",
  "average_health",
  "healthy",
  "attention",
  "high_risk",
  "revenue_at_risk",
  "expansion",
  "analyzed_meetings",
  "pending_tasks",
  "overdue_tasks",
] as const;
export const BiKpiKey = z.enum(BI_KPI_KEYS);
export type BiKpiKey = z.infer<typeof BiKpiKey>;

export const BiKpi = z.object({
  key: BiKpiKey,
  value: z.number().nullable(),
  /** Participação na carteira (0–1), quando faz sentido. */
  share: z.number().nullable(),
  direction: BiDirection,
  comparison: BiComparison,
  /** Evolução no período (um ponto por semana/mês); vazio quando o indicador não tem histórico. */
  spark: z.array(z.number().nullable()),
  /** De onde vem o número (tooltip). */
  source: z.string(),
});
export type BiKpi = z.infer<typeof BiKpi>;

export const BiBucket = z.object({ label: z.string(), start: z.string(), end: z.string() });

export const BiCustomer = z.object({
  id: Uuid,
  name: z.string(),
  segment: z.string().nullable(),
  ownerName: z.string().nullable(),
  healthScore: z.number().nullable(),
  healthClass: HealthClass.nullable(),
  mrrCents: z.number().nullable(),
  openRisks: z.number().int(),
  maxSeverity: z.string().nullable(),
  mainFactor: z.string().nullable(),
  revenueAtRiskCents: z.number().nullable(),
  openOpportunities: z.number().int(),
  pendingTasks: z.number().int(),
  overdueTasks: z.number().int(),
  lastAnalysisAt: z.string().nullable(),
});
export type BiCustomer = z.infer<typeof BiCustomer>;

export const ReportBi = z.object({
  period: z.object({
    from: z.string(),
    to: z.string(),
    compare: BiCompare,
    compareFrom: z.string(),
    compareTo: z.string(),
    granularity: z.enum(["week", "month"]),
  }),
  bands: z.object({ attentionMin: z.number(), healthyMin: z.number(), excellentMin: z.number() }),
  gauge: z.object({
    score: z.number().nullable(),
    classification: HealthClass.nullable(),
    previousMonth: z.number().nullable(),
    previousYear: z.number().nullable(),
    monthDeltaPct: z.number().nullable(),
    yearDeltaPct: z.number().nullable(),
    customersWithHealth: z.number().int(),
    activeCustomers: z.number().int(),
  }),
  kpis: z.array(BiKpi),
  buckets: z.array(BiBucket),
  healthSeries: z.array(z.object({ value: z.number().nullable(), previous: z.number().nullable() })),
  meetingsSeries: z.array(z.object({ value: z.number().int(), previous: z.number().int() })),
  distribution: z.object({
    healthy: z.number().int(),
    attention: z.number().int(),
    highRisk: z.number().int(),
    noData: z.number().int(),
  }),
  movement: z.object({
    /** Clientes com nota no início E no fim do período (base da movimentação). */
    comparable: z.number().int(),
    withoutHistory: z.number().int(),
    entered: z.number().int(),
    remained: z.number().int(),
    recovered: z.number().int(),
    improved: z.number().int(),
    worsened: z.number().int(),
  }),
  churn: z.object({
    factors: z.array(
      z.object({
        factorKey: z.string(),
        label: z.string(),
        customers: z.number().int(),
        share: z.number().nullable(),
        newInPeriod: z.number().int(),
        newInComparison: z.number().int(),
        customerRefs: z.array(z.object({ id: Uuid, name: z.string() })),
      }),
    ),
    revenue: z.object({
      atRiskCents: z.number().nullable(),
      impactedCustomers: z.number().int(),
      customersWithoutRevenue: z.number().int(),
      recoveredCents: z.number().nullable(),
      recoveredCustomers: z.number().int(),
      series: z.array(z.number().nullable()),
    }),
    priority: z.array(
      z.object({
        id: Uuid,
        name: z.string(),
        healthScore: z.number().nullable(),
        healthClass: HealthClass.nullable(),
        maxSeverity: z.string().nullable(),
        mainFactor: z.string().nullable(),
        lastAnalysisAt: z.string().nullable(),
        planTitle: z.string().nullable(),
        openTasks: z.number().int(),
        ownerName: z.string().nullable(),
        nextAction: z.string().nullable(),
      }),
    ),
  }),
  expansion: z.object({
    identified: z.number().int(),
    identifiedComparison: z.number().int(),
    customersWithPotential: z.number().int(),
    inFollowUp: z.number().int(),
    potentialCents: z.number().nullable(),
    converted: z.number().int(),
    convertedComparison: z.number().int(),
    series: z.array(z.object({ identified: z.number().int(), converted: z.number().int() })),
    ranking: z.array(
      z.object({
        id: Uuid,
        customerId: Uuid,
        customerName: z.string(),
        type: z.string(),
        need: z.string(),
        evidence: z.string().nullable(),
        ownerName: z.string().nullable(),
        status: z.string(),
        nextAction: z.string().nullable(),
        potentialCents: z.number().nullable(),
      }),
    ),
  }),
  plans: z.object({
    created: z.number().int(),
    createdComparison: z.number().int(),
    completed: z.number().int(),
    completedComparison: z.number().int(),
    pending: z.number().int(),
    overdue: z.number().int(),
    /** Concluídas ÷ criadas no período (sem canceladas). */
    completionRate: z.number().nullable(),
    completionRateComparison: z.number().nullable(),
    avgCompletionDays: z.number().nullable(),
    series: z.array(z.object({ created: z.number().int(), completed: z.number().int() })),
  }),
  indicators: z.array(
    z.object({
      indicator: z.string(),
      average: z.number().nullable(),
      previous: z.number().nullable(),
      samples: z.number().int(),
      series: z.array(z.number().nullable()),
    }),
  ),
  customers: z.array(BiCustomer),
  filtersApplied: BiFilters,
});
export type ReportBi = z.infer<typeof ReportBi>;
