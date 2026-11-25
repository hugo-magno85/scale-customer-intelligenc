import { HEALTH_INDICATORS, type HealthSettings, type Indicator, type IndicatorResult } from "@sci/contracts";

export interface HealthInput {
  indicators: IndicatorResult[];
  settings: HealthSettings;
  previousScore: number | null;
  /** Sinais de churn abertos do cliente (após esta análise). */
  openChurn: { factorKey: string; severity: "low" | "medium" | "high" | "critical" }[];
}

export interface HealthResult {
  score: number | null;
  classification: "healthy" | "attention" | "high_risk" | null;
  factors: {
    indicator: Indicator;
    score: number;
    weight: number;
    impact: number;
    direction: "up" | "down" | "neutral";
  }[];
  missing: Indicator[];
  overrides: string[];
  weights: Record<string, number>;
}

/**
 * Customer Health explicável: média ponderada (pesos do tenant) dos indicadores com evidência,
 * suavizada pelo histórico. Sem dados suficientes, a nota é nula — nunca inventada.
 * Sinais de churn graves funcionam como trava da classificação.
 */
export function computeHealth(input: HealthInput): HealthResult {
  const { settings } = input;
  const weights = settings.weights as Record<string, number>;
  const available = input.indicators.filter(
    (i) => (HEALTH_INDICATORS as readonly string[]).includes(i.indicator) && i.score !== null,
  );
  const missing = HEALTH_INDICATORS.filter((k) => !available.some((a) => a.indicator === k)) as Indicator[];
  const totalWeight = available.reduce((s, i) => s + (weights[i.indicator] ?? 0), 0);
  const overrides: string[] = [];
  if (available.length < settings.minIndicators || totalWeight <= 0) {
    return {
      score: null,
      classification: null,
      factors: [],
      missing,
      overrides: ["Dados insuficientes nesta reunião para calcular o Customer Health."],
      weights,
    };
  }
  const current = available.reduce((s, i) => s + i.score! * (weights[i.indicator] ?? 0), 0) / totalWeight;
  let score =
    input.previousScore === null
      ? current
      : current * (1 - settings.historyWeight) + input.previousScore * settings.historyWeight;
  score = Math.round(score * 10) / 10;

  // Fator: contribuição relativa a um cliente neutro (50)
  const factors = available
    .map((i) => {
      const w = (weights[i.indicator] ?? 0) / totalWeight;
      const impact = Math.round((i.score! - 50) * w * 10) / 10;
      return {
        indicator: i.indicator,
        score: i.score!,
        weight: Math.round(w * 1000) / 1000,
        impact,
        direction: (impact > 0.5 ? "up" : impact < -0.5 ? "down" : "neutral") as "up" | "down" | "neutral",
      };
    })
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  let classification: HealthResult["classification"] =
    score >= settings.healthyMin ? "healthy" : score >= settings.attentionMin ? "attention" : "high_risk";
  const critical = input.openChurn.find((c) => c.severity === "critical");
  const high = input.openChurn.filter((c) => c.severity === "high");
  if (critical) {
    classification = "high_risk";
    overrides.push(`Classificado como risco alto por sinal crítico aberto (${critical.factorKey}).`);
  } else if (high.length && classification === "healthy") {
    classification = "attention";
    overrides.push(`Limitado a "atenção" por ${high.length} sinal(is) de risco alto aberto(s).`);
  }
  if (input.previousScore !== null)
    overrides.push(`Nota suavizada com o histórico (peso ${settings.historyWeight}).`);
  return { score, classification, factors, missing, overrides, weights };
}
