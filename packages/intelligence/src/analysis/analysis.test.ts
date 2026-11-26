import { HealthSettings, TenantSkillSettings, type IndicatorResult } from "@sci/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DecisionProvider } from "../providers/jev.js";
import type { ReasoningProvider } from "../providers/types.js";
import { analyzeMeeting, capChurnLevel, resolveSeverity, type AnalysisInput } from "./analyze.js";
import { computeHealth } from "./health.js";

const ind = (indicator: IndicatorResult["indicator"], score: number | null): IndicatorResult => ({
  indicator,
  score,
  classification: null,
  confidence: 0.8,
  rationale: "",
  evidence: score === null ? [] : [{ segmentId: 1, speaker: "customer", text: "x", startMs: 0 }],
});
const hs = HealthSettings.parse({});

describe("Customer Health", () => {
  it("média ponderada pelos pesos do tenant, com fatores explicáveis", () => {
    const r = computeHealth({
      indicators: [ind("adoption", 25), ind("value_perception", 75), ind("satisfaction", 75)],
      settings: hs,
      previousScore: null,
      openChurn: [],
    });
    // (25*2 + 75*2 + 75*1.5) / 5.5
    expect(r.score).toBeCloseTo(56.8, 1);
    expect(r.classification).toBe("attention");
    expect(r.factors.find((f) => f.indicator === "adoption")!.direction).toBe("down");
    expect(r.missing).toEqual(expect.arrayContaining(["engagement", "trust", "expectation_alignment"]));
  });

  it("dados insuficientes → nota nula (não inventa)", () => {
    const r = computeHealth({
      indicators: [ind("adoption", 50), ind("trust", null)],
      settings: hs,
      previousScore: 80,
      openChurn: [],
    });
    expect(r.score).toBeNull();
    expect(r.classification).toBeNull();
  });

  it("suaviza com o histórico e aplica trava por sinal crítico", () => {
    const base = [ind("adoption", 100), ind("trust", 100), ind("satisfaction", 100)];
    expect(computeHealth({ indicators: base, settings: hs, previousScore: 50, openChurn: [] }).score).toBe(
      85,
    );
    const crit = computeHealth({
      indicators: base,
      settings: hs,
      previousScore: null,
      openChurn: [{ factorKey: "cancellation_intent", severity: "critical" }],
    });
    expect(crit.classification).toBe("high_risk");
    expect(crit.overrides[0]).toContain("sinal crítico");
  });

  it("pesos configuráveis mudam a nota", () => {
    const custom = HealthSettings.parse({
      weights: {
        adoption: 10,
        engagement: 0,
        satisfaction: 0,
        trust: 0,
        value_perception: 0,
        expectation_alignment: 1,
      },
    });
    const r = computeHealth({
      indicators: [ind("adoption", 0), ind("trust", 100), ind("expectation_alignment", 100)],
      settings: custom,
      previousScore: null,
      openChurn: [],
    });
    expect(r.score).toBeCloseTo(9.1, 1);
  });
});

describe("prudência em churn", () => {
  it("frase isolada não vira risco alto; intenção explícita vira crítico", () => {
    expect(resolveSeverity("loss_of_trust", "high", 1, 0)).toBe("medium");
    expect(resolveSeverity("loss_of_trust", "high", 2, 0)).toBe("high");
    expect(resolveSeverity("cancellation_intent", null, 1, 0)).toBe("critical");
    expect(resolveSeverity("no_value_perception", "critical", 3, 0)).toBe("high");
  });

  it("recorrência eleva a severidade; crítico exige recorrência ≥ 3", () => {
    expect(resolveSeverity("low_adoption", null, 1, 1)).toBe("high");
    expect(resolveSeverity("recurring_complaints", "critical", 2, 2)).toBe("critical");
  });

  it("indicador de risco de churn limitado sem sinais combinados", () => {
    const one = [
      {
        factorKey: "low_adoption",
        label: "",
        severity: "medium" as const,
        evidence: [],
        recommendation: "",
        nextAction: null,
      },
    ];
    expect(capChurnLevel(4, one, [])).toBe(2);
    expect(capChurnLevel(4, [...one, { ...one[0]!, factorKey: "dissatisfaction" }], [])).toBe(3);
    expect(capChurnLevel(4, [{ ...one[0]!, factorKey: "cancellation_intent" }], [])).toBe(4);
  });
});

const input = (over: Partial<AnalysisInput> = {}): AnalysisInput => ({
  meetingType: "follow_up",
  objective: null,
  playbook: null,
  settings: TenantSkillSettings.parse({}),
  transcript: [
    { id: 10, speaker: "internal", text: "Como está o uso da ferramenta?", startMs: 0 },
    {
      id: 11,
      speaker: "customer",
      text: "Estamos usando pouco porque a equipe não se adaptou.",
      startMs: 3000,
    },
    {
      id: 12,
      speaker: "customer",
      text: "Temos uma nova filial que também precisaria da solução.",
      startMs: 9000,
    },
  ],
  liveSignals: [],
  notes: [],
  suggestionsDone: [],
  checklistOpen: [{ label: "Próximos passos", required: true }],
  openChurn: [],
  ...over,
});

const llm = (data: unknown): ReasoningProvider => ({
  name: "f",
  completeJson: vi.fn(async (req) => ({
    data: req.schema.parse(data),
    model: "deep-1",
    usage: { inputTokens: 1, outputTokens: 1 },
    attempts: 1,
  })) as never,
});

describe("análise pós-reunião", () => {
  it("evidências vêm da transcrição real; ids inválidos e falas do CS não sustentam risco", async () => {
    const out = await analyzeMeeting(input(), {
      reasoning: llm({
        summary: "Cliente com baixa adoção.",
        indicators: [
          { indicator: "adoption", level: 1, confidence: 0.8, rationale: "Uso baixo.", evidence: [11] },
          { indicator: "trust", level: 3, confidence: 0.5, rationale: "Sem base", evidence: [999] },
          { indicator: "churn_risk", level: 4, confidence: 0.7, rationale: "", evidence: [11] },
        ],
        risks: [
          { factorKey: "low_adoption", severity: "high", evidence: [11], recommendation: "Treinar equipe" },
          { factorKey: "dissatisfaction", severity: "high", evidence: [10] },
          { factorKey: "inexistente", evidence: [11] },
        ],
        opportunities: [{ type: "new_area", need: "Nova filial", evidence: [12] }],
        actions: [
          {
            title: "Agendar treinamento",
            responsibleParty: "internal",
            dueInDays: 5,
            priority: "high",
            evidence: [11],
          },
          { title: "Sem base", evidence: [] },
        ],
      }),
    });
    expect(out.mode).toBe("full");
    expect(out.indicators.find((i) => i.indicator === "adoption")).toMatchObject({
      score: 25,
      classification: "low",
      evidence: [{ segmentId: 11, text: "Estamos usando pouco porque a equipe não se adaptou." }],
    });
    expect(out.indicators.find((i) => i.indicator === "trust")!.score).toBeNull();
    expect(out.indicators.find((i) => i.indicator === "churn_risk")!.score).toBe(50); // limitado por prudência
    expect(out.risks.map((r) => [r.factorKey, r.severity])).toEqual([["low_adoption", "medium"]]);
    expect(out.opportunities[0]!.nextAction).toContain("após tratar os riscos");
    expect(out.actions.map((a) => a.title)).toEqual(["Agendar treinamento"]);
    expect(out.warnings.join(" ")).toContain("descartado");
  });

  it("fala do profissional (CS) não sustenta nota de indicador do cliente", async () => {
    const out = await analyzeMeeting(input(), {
      reasoning: llm({
        indicators: [
          { indicator: "satisfaction", level: 1, confidence: 0.8, rationale: "x", evidence: [10] },
          { indicator: "adoption", level: 1, confidence: 0.8, rationale: "x", evidence: [10, 11] },
        ],
      }),
    });
    const sat = out.indicators.find((i) => i.indicator === "satisfaction")!;
    expect(sat.score).toBeNull();
    expect(sat.rationale).toContain("falas do cliente");
    expect(out.indicators.find((i) => i.indicator === "adoption")!.evidence.map((e) => e.segmentId)).toEqual([
      11,
    ]);
  });

  it("conferência do Jev descarta conclusão sem sustentação", async () => {
    const decisions: DecisionProvider = {
      name: "j",
      decide: vi.fn(async () => ({ answers: { r0: { noul: 0.2 }, o0: { noul: 0.9 } } })) as never,
    };
    const out = await analyzeMeeting(input(), {
      reasoning: llm({
        risks: [{ factorKey: "low_adoption", evidence: [11] }],
        opportunities: [{ type: "new_area", need: "Nova filial", evidence: [12] }],
      }),
      decisions,
    });
    expect(out.risks).toHaveLength(0);
    expect(out.opportunities).toHaveLength(1);
    expect(out.warnings.join(" ")).toContain("conferência");
  });

  it("modo básico sem DeepSeek: usa sinais da reunião, sem indicadores", async () => {
    const out = await analyzeMeeting(
      input({
        liveSignals: [
          {
            kind: "risk",
            key: "low_adoption",
            label: "Baixa adoção",
            evidenceSegmentId: 11,
            evidenceText: "",
          },
        ],
      }),
      { reasoning: null },
    );
    expect(out.mode).toBe("basic");
    expect(out.indicators.every((i) => i.score === null)).toBe(true);
    expect(out.risks[0]).toMatchObject({ factorKey: "low_adoption", evidence: [{ segmentId: 11 }] });
    expect(out.actions[0]!.title).toBe("Tratar: Baixa adoção");
    expect(out.unansweredQuestions).toEqual(["Próximos passos"]);
  });

  it("sem transcrição: nada é concluído", async () => {
    const out = await analyzeMeeting(input({ transcript: [] }), { reasoning: llm({}) });
    expect(out.risks).toHaveLength(0);
    expect(out.indicators.every((i) => i.score === null)).toBe(true);
    expect(out.warnings[0]).toContain("sem transcrição");
  });
});
