import { z } from "zod";

/**
 * Indicadores do dashboard. `null` significa "sem dados suficientes" e
 * nunca deve ser substituído por um número estimado.
 */
export const DashboardSummary = z.object({
  activeCustomers: z.number().int(),
  healthy: z.number().int().nullable(),
  attention: z.number().int().nullable(),
  highRisk: z.number().int().nullable(),
  averageHealth: z.number().nullable(),
  revenueAtRiskCents: z.number().int().nullable(),
  openExpansionOpportunities: z.number().int().nullable(),
  analyzedMeetings: z.number().int(),
  pendingActionTasks: z.number().int().nullable(),
  overdueActionTasks: z.number().int().nullable(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;
