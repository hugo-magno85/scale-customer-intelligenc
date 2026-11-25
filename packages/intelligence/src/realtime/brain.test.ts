import { PlaybookStructure, TenantSkillSettings, type Suggestion } from "@sci/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DecisionProvider } from "../providers/jev.js";
import type { ReasoningProvider } from "../providers/types.js";
import { MeetingBrain, similar } from "./brain.js";
import type { BrainContext } from "./types.js";

const settings = TenantSkillSettings.parse({});
const ctx = (over: Partial<BrainContext> = {}): BrainContext => ({
  meetingId: "00000000-0000-4000-8000-000000000001",
  meetingType: "follow_up",
  objective: null,
  playbook: null,
  settings,
  customer: { name: "ACME", segment: null },
  history: [],
  ...over,
});
let segId = 1;
const say = (speaker: "customer" | "internal", text: string) => ({
  id: segId++,
  speaker,
  text,
  startMs: segId * 1000,
});

describe("MeetingBrain — exemplo de referência (baixa adoção)", () => {
  it("identifica o sinal, recomenda, detecta a pergunta feita e aprofunda em cadeia", async () => {
    const b = new MeetingBrain(ctx());
    await b.prepare();
    expect(b.state().current).not.toBeNull();
    // força a troca para a sugestão guiada por sinal
    b.onSegment(
      say(
        "customer",
        "Estamos utilizando pouco o sistema porque nossa equipe ainda não conseguiu se adaptar.",
      ),
      0,
    );
    await b.analyze();
    // a sugestão de preparação continua até ser resolvida; pedir outra respeita o sinal
    await b.requestAnother();
    let st = b.state();
    expect(st.signals.map((s) => s.key)).toContain("low_adoption");
    expect(st.current!.question).toBe(
      "Quais funcionalidades estão apresentando maior dificuldade para a equipe utilizar no dia a dia?",
    );
    expect(st.current!.priority).toBe("high");
    expect(st.current!.evidence?.text).toContain("utilizando pouco");
    expect(st.current!.reason).toContain("O cliente disse");
    expect(st.current!.indicator).toBe("adoption");

    // o profissional faz a pergunta → detectada → aprofundamento
    b.onSegment(
      say(
        "internal",
        "Quais funcionalidades estão apresentando maior dificuldade para a equipe no dia a dia?",
      ),
      0,
    );
    await b.analyze();
    st = b.state();
    expect(st.current!.question).toBe(
      "Essa dificuldade está concentrada em algumas pessoas ou está acontecendo em toda a operação?",
    );
    expect(st.current!.type).toBe("deepening");

    await b.markDone(st.current!.id);
    expect(b.state().current!.question).toBe(
      "Se conseguíssemos resolver esse ponto, quais resultados vocês esperariam alcançar com a ferramenta?",
    );
  });
});

describe("MeetingBrain — regras de decisão", () => {
  const playbook = PlaybookStructure.parse({
    questions: [
      {
        key: "abertura",
        text: "Quais são as prioridades da sua equipe neste trimestre?",
        type: "diagnosis",
        purpose: "Entender prioridades",
        priority: "high",
        required: true,
        weight: 5,
      },
      {
        key: "upsell",
        text: "Vocês pensam em ampliar o uso para outras áreas?",
        type: "expansion",
        purpose: "Expansão",
        priority: "high",
        weight: 5,
      },
    ],
  });

  it("preparação começa pela pergunta obrigatória do playbook, com referência", async () => {
    const b = new MeetingBrain(ctx({ playbook }));
    const s = await b.prepare();
    expect(s.current!.playbookRef?.questionKey).toBe("abertura");
    expect(s.checklist.some((c) => c.key === "pb:abertura" && c.required)).toBe(true);
    expect(s.checklist.some((c) => c.key === "topic:next_steps")).toBe(true);
    expect(s.preparationNotes[0]).toContain("Objetivo deste tipo de reunião");
    expect(s.degraded.length).toBe(2);
  });

  it("não sugere expansão enquanto houver risco aberto", async () => {
    const b = new MeetingBrain(ctx({ playbook }));
    await b.prepare();
    b.onSegment(say("customer", "Estamos pensando em cancelar o contrato e avaliando outra ferramenta."), 0);
    await b.analyze();
    expect(b.state().signals.map((s) => s.key)).toContain("cancellation_intent");
    const all = b.rankCandidates().map((r) => r.candidate.type);
    expect(all).not.toContain("expansion");
  });

  it("respeita os tipos de pergunta habilitados pelo tenant", async () => {
    const only = TenantSkillSettings.parse({ enabledQuestionTypes: ["risk", "commitment"] });
    const b = new MeetingBrain(ctx({ settings: only }));
    expect(b.rankCandidates().every((r) => ["risk", "commitment"].includes(r.candidate.type))).toBe(true);
  });

  it("ignorar e pedir outra nunca repetem a mesma pergunta", async () => {
    const b = new MeetingBrain(ctx());
    const seen = new Set<string>();
    let st = await b.prepare();
    for (let i = 0; i < 6; i++) {
      seen.add(st.current!.question);
      st = i % 2 ? await b.ignore(st.current!.id) : await b.requestAnother();
      if (st.current) expect(seen.has(st.current.question)).toBe(false);
    }
  });

  it("persiste sugestões, mudanças de status e sinais", async () => {
    const persistence = {
      suggestion: vi.fn(async () => {}),
      suggestionStatus: vi.fn(async () => {}),
      signal: vi.fn(async () => {}),
      checklist: vi.fn(async () => {}),
    };
    const b = new MeetingBrain(ctx(), { persistence });
    const st = await b.prepare();
    await b.markDone(st.current!.id);
    b.onSegment(say("customer", "Não vimos resultado até agora, não sei se está valendo a pena."), 0);
    await b.analyze();
    expect(persistence.suggestion).toHaveBeenCalledTimes(2);
    expect(persistence.suggestionStatus).toHaveBeenCalledWith(st.current!.id, "done");
    expect(persistence.signal).toHaveBeenCalledWith(
      expect.objectContaining({ key: "no_value_perception", source: "heuristic" }),
    );
  });
});

describe("MeetingBrain — com Jev e DeepSeek", () => {
  const answers = (over: Record<string, unknown> = {}) => ({
    risk: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
    opportunity: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
    asked: { type: "noul", noul: 0.1 },
    answerComplete: { type: "noul", noul: 0.9 },
    cov0: { type: "noul", noul: 0.9 },
    ...over,
  });

  it("usa as decisões do Jev: sinal com probabilidade, cobertura e prudência", async () => {
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        answers: answers({
          risk: { choice: "loss_of_trust", confidence: 0.55, probabilities: { loss_of_trust: 0.55 } },
        }),
      })
      .mockResolvedValueOnce({
        answers: answers({
          risk: { choice: "loss_of_trust", confidence: 0.82, probabilities: { loss_of_trust: 0.82 } },
        }),
      });
    const decisions: DecisionProvider = { name: "jev", decide } as never;
    const b = new MeetingBrain(ctx(), { decisions });
    await b.prepare();
    b.onSegment(say("customer", "Talvez."), 0);
    await b.analyze();
    expect(b.state().signals).toHaveLength(0); // 0.55 < limiar
    b.onSegment(say("customer", "Sinceramente, vocês prometem e não cumprem."), 0);
    await b.analyze();
    const st = b.state();
    expect(st.signals[0]).toMatchObject({ key: "loss_of_trust", source: "jev", confidence: 0.82 });
    expect(st.checklist[0]!.status).toBe("covered");
    expect(decide.mock.calls[0]![0].state.transcricaoRecente[0]).toEqual({
      quem: "cliente",
      fala: "Talvez.",
    });
  });

  it("Jev indisponível → heurística e aviso de modo degradado", async () => {
    const decisions: DecisionProvider = {
      name: "jev",
      decide: vi.fn().mockRejectedValue(new Error("503")),
    } as never;
    const b = new MeetingBrain(ctx(), { decisions });
    await b.prepare();
    b.onSegment(say("customer", "A equipe ainda não se adaptou, estamos usando pouco."), 0);
    await b.analyze();
    expect(b.state().signals[0]).toMatchObject({ key: "low_adoption" });
    expect(b.state().degraded.join(" ")).toContain("temporariamente indisponível");
  });

  it("adapta a pergunta com o DeepSeek e cai para o texto base se demorar", async () => {
    const fast: ReasoningProvider = {
      name: "ds",
      completeJson: vi.fn(async () => ({
        data: {
          question: "Quais telas mais travam a equipe hoje?",
          reason: "Ela citou baixa adoção agora há pouco.",
          objective: "Achar a barreira de uso",
        },
        model: "ds-fast",
        usage: { inputTokens: 1, outputTokens: 1 },
        attempts: 1,
      })) as never,
    };
    const b = new MeetingBrain(ctx(), { reasoning: fast });
    await b.prepare();
    b.onSegment(say("customer", "Estamos usando pouco o sistema."), 0);
    await b.analyze();
    await b.requestAnother();
    expect(b.state().current).toMatchObject({
      question: "Quais telas mais travam a equipe hoje?",
      adaptedBy: "ds-fast",
    });

    const slow: ReasoningProvider = {
      name: "ds",
      completeJson: (req) =>
        new Promise((_r, rej) => req.signal?.addEventListener("abort", () => rej(new Error("abort")))),
    };
    const b2 = new MeetingBrain(ctx(), { reasoning: slow, adaptTimeoutMs: 50 });
    await b2.prepare();
    b2.onSegment(say("customer", "Estamos usando pouco o sistema."), 0);
    await b2.analyze();
    const s: Suggestion = (await b2.requestAnother()).current!;
    expect(s.adaptedBy).toBeNull();
    expect(s.question.endsWith("?")).toBe(true);
  });
});

describe("similaridade (modo básico)", () => {
  it("reconhece reformulações próximas e rejeita perguntas diferentes", () => {
    expect(
      similar(
        "Quais funcionalidades estão apresentando maior dificuldade para a equipe?",
        "Quais funcionalidades estão apresentando maior dificuldade para a equipe utilizar no dia a dia?",
      ),
    ).toBe(true);
    expect(
      similar("Como está o tempo hoje?", "Quais funcionalidades estão apresentando maior dificuldade?"),
    ).toBe(false);
  });
});

describe("precedência do playbook", () => {
  it("na preparação, pergunta comum do playbook vence pergunta reativa da biblioteca sem sinal", async () => {
    const playbook = PlaybookStructure.parse({
      questions: [
        { key: "uso", text: "Quais funcionalidades a equipe mais usa?", type: "adoption", purpose: "Adoção" },
      ],
    });
    const b = new MeetingBrain(ctx({ playbook }));
    const ranked = b.rankCandidates();
    const reactive = ranked.find((r) => r.candidate.key === "lib:implementation_blocker");
    const pb = ranked.find((r) => r.candidate.key === "pb:uso");
    expect(pb!.score).toBeGreaterThan(reactive?.score ?? -Infinity);
    const s = await b.prepare();
    expect(s.current!.playbookRef?.questionKey).toBe("uso");
  });
});
