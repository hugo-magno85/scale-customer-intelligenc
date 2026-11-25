import { INDICATORS, MEETING_TYPES, QUESTION_TYPES, TenantSkillSettings } from "@sci/contracts";
import { describe, expect, it } from "vitest";
import {
  COVERAGE_TOPICS,
  INDICATOR_KNOWLEDGE,
  MEETING_TYPE_KNOWLEDGE,
  OPPORTUNITY_TYPES,
  QUESTION_LIBRARY,
  QUESTION_TYPE_KNOWLEDGE,
  RISK_SIGNALS,
  SKILL_CONTENT_HASH,
  SKILL_VERSION,
  renderSkillInstructions,
  skillManifest,
} from "./index.js";

describe("integridade da skill de CS", () => {
  it("versão semântica e hash estáveis", () => {
    expect(SKILL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SKILL_CONTENT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cobre os 8 indicadores, 12 tipos de pergunta e todos os tipos de reunião", () => {
    expect(INDICATOR_KNOWLEDGE.map((i) => i.key).sort()).toEqual([...INDICATORS].sort());
    expect(Object.keys(QUESTION_TYPE_KNOWLEDGE).sort()).toEqual([...QUESTION_TYPES].sort());
    expect(Object.keys(MEETING_TYPE_KNOWLEDGE).sort()).toEqual([...MEETING_TYPES].sort());
  });

  it("cobre os 10 sinais de churn do escopo", () => {
    expect(RISK_SIGNALS).toHaveLength(10);
  });

  it("chaves da biblioteca são únicas e referências são válidas", () => {
    const keys = QUESTION_LIBRARY.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    const signalKeys = new Set([...RISK_SIGNALS.map((s) => s.key), ...OPPORTUNITY_TYPES.map((o) => o.key)]);
    for (const q of QUESTION_LIBRARY) {
      for (const s of q.signals) expect(signalKeys, `${q.key} → ${s}`).toContain(s);
      for (const c of q.covers) expect(Object.keys(COVERAGE_TOPICS), `${q.key} → ${c}`).toContain(c);
      expect(q.text.endsWith("?"), q.key).toBe(true);
    }
  });

  it("todo sinal de churn tem ao menos uma pergunta de investigação", () => {
    for (const s of RISK_SIGNALS) {
      expect(
        QUESTION_LIBRARY.some((q) => q.signals.includes(s.key)),
        s.key,
      ).toBe(true);
    }
  });

  it("todo tópico obrigatório de reunião tem pergunta que o cobre (exceto objetivos, coberto pelo playbook)", () => {
    for (const [type, k] of Object.entries(MEETING_TYPE_KNOWLEDGE)) {
      for (const topic of k.mustCover.filter((t) => t !== "objectives")) {
        expect(
          QUESTION_LIBRARY.some((q) => q.covers.includes(topic)),
          `${type}/${topic}`,
        ).toBe(true);
      }
    }
  });

  it("contém a cadeia de aprofundamento de adoção do exemplo de referência", () => {
    const q = QUESTION_LIBRARY.find((x) => x.key === "adoption_hardest_features")!;
    expect(q.followUps).toHaveLength(2);
  });
});

describe("renderização da Camada 1", () => {
  it("inclui regras de prudência e respeita configurações do tenant", () => {
    const settings = TenantSkillSettings.parse({
      enabledQuestionTypes: ["adoption", "risk"],
      formality: "formal",
      focusIndicators: ["adoption"],
      additionalGuidelines: ["Sempre mencionar o gerente de conta"],
    });
    const text = renderSkillInstructions(settings);
    expect(text).toContain("Não classifique churn iminente com base em uma frase isolada");
    expect(text).toContain("Tom das perguntas: formal");
    expect(text).toContain("Sempre mencionar o gerente de conta");
    expect(text).toContain("- adoption (Adoção)");
    expect(text).not.toContain("- expansion (Expansão):");
  });

  it("manifesto expõe versão e listas", () => {
    const m = skillManifest();
    expect(m.indicators).toHaveLength(8);
    expect(m.questionTypes).toHaveLength(12);
  });
});
