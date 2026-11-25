import { z } from "zod";
import { Uuid } from "./common.js";
import { HealthClass } from "./customers.js";
import { DashboardSummary } from "./dashboard.js";

export const ReportFilters = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  ownerUserId: Uuid.optional(),
  segment: z.string().trim().max(120).optional(),
  playbookId: Uuid.optional(),
  health: HealthClass.optional(),
  /** Apenas clientes com sinal de churn aberto. */
  risk: z.enum(["any", "high", "critical"]).optional(),
});
export type ReportFilters = z.infer<typeof ReportFilters>;

export const WeeklyPoint = z.object({
  week: z.string(),
  averageHealth: z.number().nullable(),
  analyzedMeetings: z.number().int(),
  newRiskSignals: z.number().int(),
  newOpportunities: z.number().int(),
});

export const ReportOverview = z.object({
  summary: DashboardSummary,
  weekly: z.array(WeeklyPoint),
  topRiskFactors: z.array(
    z.object({ factorKey: z.string(), label: z.string(), customers: z.number().int() }),
  ),
  indicatorAverages: z.array(
    z.object({ indicator: z.string(), average: z.number().nullable(), samples: z.number().int() }),
  ),
  customers: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      ownerName: z.string().nullable(),
      segment: z.string().nullable(),
      healthScore: z.number().nullable(),
      healthClass: HealthClass.nullable(),
      openRisks: z.number().int(),
      maxSeverity: z.string().nullable(),
      meetings: z.number().int(),
    }),
  ),
  filtersApplied: ReportFilters,
});
export type ReportOverview = z.infer<typeof ReportOverview>;

export const EXPORT_TYPES = [
  "customers",
  "meetings",
  "churn",
  "opportunities",
  "tasks",
  "indicators",
] as const;
export const ExportType = z.enum(EXPORT_TYPES);
export type ExportType = z.infer<typeof ExportType>;
