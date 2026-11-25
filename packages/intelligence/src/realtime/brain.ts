import { randomUUID } from "node:crypto";
import { OPPORTUNITY_TYPES, renderSkillInstructions, RISK_SIGNALS } from "@sci/cs-skill";
import type { ChecklistItem, Evidence, LiveSignal, MeetingIntelligence, Suggestion } from "@sci/contracts";
import { z } from "zod";
import { choice, noul, type DecisionProvider } from "../providers/jev.js";
import type { ReasoningProvider } from "../providers/types.js";
import { buildCandidates, buildChecklist, normalize, preparationNotes } from "./candidates.js";
import { detectHeuristic, type DetectedSignal } from "./heuristics.js";
import type { BrainContext, BrainPersistence, Candidate, Segment } from "./types.js";

export interface BrainDeps {
  decisions?: DecisionProvider | null;
  reasoning?: ReasoningProvider | null;
  persistence?: BrainPersistence;
  now?: () => number;
  /** Tempo máximo para adaptar a pergunta com o DeepSeek antes de usar o texto base. */
  adaptTimeoutMs?: number;
  log?: (msg: string, data?: object) => void;
}

const RECENT_WINDOW = 10;
const SIGNAL_FRESH_MS = 4 * 60_000;
const PRIORITY_SCORE = { high: 3, medium: 2, low: 1 } as const;
const SEVERITY_BONUS: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

const Adapted = z.object({
  question: z.string().trim().min(5).max(400),
  reason: z.string().trim().min(5).max(400),
  objective: z.string().trim().min(3).max(300),
});

/**
 * Motor de decisão (Camada 5): combina skill de CS, playbook, contexto do cliente
 * e o que está acontecendo na reunião para decidir a próxima pergunta.
 *
 * O assistente recomenda; o profissional conduz. Nenhuma fala é gerada em nome dele.
 */
export class MeetingBrain {
  private readonly now: () => number;
  private readonly startedAt: number;
  private candidates: Candidate[];
  private checklist: ChecklistItem[];
  private readonly prepNotes: string[];
  private segments: Segment[] = [];
  private suggestions: Suggestion[] = [];
  private readonly used = new Set<string>();
  private signals: (LiveSignal & { at: number })[] = [];
  private current: Suggestion | null = null;
  private alternatives: Suggestion[] = [];
  private lastSuggestionAt = 0;
  private mode: MeetingIntelligence["mode"] = "preparation";
  private analyzing: Promise<void> | null = null;
  /** Índice do primeiro segmento ainda não analisado. */
  private analyzedUpTo = 0;
  private pendingAnalysis = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: MeetingIntelligence) => void>();
  private readonly degraded = new Set<string>();

  constructor(
    private readonly ctx: BrainContext,
    private readonly deps: BrainDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.candidates = buildCandidates(ctx);
    this.checklist = buildChecklist(ctx);
    this.prepNotes = preparationNotes(ctx);
    if (!deps.decisions) this.degraded.add("Detecção de sinais em modo básico (Jev não configurado).");
    if (!deps.reasoning) this.degraded.add("Perguntas sem adaptação ao contexto (DeepSeek não configurado).");
  }

  onChange(cb: (s: MeetingIntelligence) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  state(): MeetingIntelligence {
    return {
      meetingId: this.ctx.meetingId,
      mode: this.mode,
      current: this.current,
      alternatives: this.alternatives,
      checklist: this.checklist,
      signals: this.signals.map(({ at: _at, ...s }) => s),
      preparationNotes: this.prepNotes,
      degraded: [...this.degraded],
    };
  }

  /** Restaura o estado persistido (ao reconectar). */
  restore(data: {
    suggestions: Suggestion[];
    signals: LiveSignal[];
    segments: Segment[];
    checklist?: ChecklistItem[];
  }) {
    this.suggestions = [...data.suggestions];
    for (const s of data.suggestions) this.used.add(s.candidateKey);
    this.current = data.suggestions.find((s) => s.status === "shown") ?? null;
    this.signals = data.signals.map((s) => ({ ...s, at: new Date(s.createdAt).getTime() }));
    this.segments = data.segments.slice(-200);
    this.analyzedUpTo = this.segments.length;
    if (data.checklist?.length) {
      const byKey = new Map(data.checklist.map((c) => [c.key, c.status]));
      this.checklist = this.checklist.map((c) => ({ ...c, status: byKey.get(c.key) ?? c.status }));
    }
    if (this.segments.length) this.mode = "copilot";
  }

  /** Modo Preparação: primeira recomendação antes da conversa começar. */
  async prepare(): Promise<MeetingIntelligence> {
    if (!this.current) await this.suggestNext(null, "prepare");
    this.emit();
    return this.state();
  }

  /** Novo segmento final da transcrição. A análise é agendada (debounce) e nunca sobreposta. */
  onSegment(seg: Segment, debounceMs = 1200) {
    this.mode = "copilot";
    this.segments.push(seg);
    if (this.segments.length > 400) {
      const drop = this.segments.length - 400;
      this.segments.splice(0, drop);
      this.analyzedUpTo = Math.max(0, this.analyzedUpTo - drop);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.analyze(), debounceMs);
  }

  end() {
    if (this.timer) clearTimeout(this.timer);
    this.mode = "ended";
    this.emit();
  }

  /** Executa a análise já (serializada: se houver uma em curso, agenda outra ao final). */
  async analyze(): Promise<void> {
    if (this.analyzing) {
      this.pendingAnalysis = true;
      return this.analyzing;
    }
    this.analyzing = this.runAnalysis()
      .catch((err: Error) => this.deps.log?.("falha na análise em tempo real", { err: err.message }))
      .finally(() => {
        this.analyzing = null;
        if (this.pendingAnalysis) {
          this.pendingAnalysis = false;
          void this.analyze();
        }
      });
    return this.analyzing;
  }

  private recent(): Segment[] {
    return this.segments.slice(-RECENT_WINDOW);
  }

  private async runAnalysis() {
    const recent = this.recent();
    if (!recent.length) return;
    // Todas as falas novas desde a última análise (várias podem chegar entre dois ciclos)
    const fresh = this.segments.slice(this.analyzedUpTo);
    this.analyzedUpTo = this.segments.length;
    const freshCustomer = fresh.filter((s) => s.speaker === "customer");
    const lastCustomer = freshCustomer.at(-1) ?? null;
    let detected: (DetectedSignal & { seg: Segment | null })[];
    let askedCurrent = false;
    let answerIncomplete = false;
    const covered = new Map<string, number>();
    const heuristic = () =>
      freshCustomer.flatMap((seg) => detectHeuristic(seg.text).map((d) => ({ ...d, seg })));

    const openItems = this.checklist.filter((c) => c.status !== "covered").slice(0, 8);
    if (this.deps.decisions) {
      try {
        const r = await this.decide(recent, freshCustomer, openItems);
        // evidência: a fala nova do cliente que melhor corresponde ao sinal (ou a última)
        const hints = heuristic();
        detected = r.detected.map((d) => ({
          ...d,
          seg: hints.find((h) => h.key === d.key)?.seg ?? lastCustomer,
        }));
        askedCurrent = r.askedCurrent;
        answerIncomplete = r.answerIncomplete;
        r.coverage.forEach((v, k) => covered.set(k, v));
        this.degraded.delete("Detecção de sinais temporariamente indisponível.");
      } catch (err) {
        this.degraded.add("Detecção de sinais temporariamente indisponível.");
        this.deps.log?.("Jev indisponível; usando heurística", { err: (err as Error).message });
        detected = heuristic();
      }
    } else {
      detected = heuristic();
      askedCurrent =
        !!this.current &&
        fresh.some((s) => s.speaker === "internal" && similar(s.text, this.current!.question));
    }

    // Sinais: registra apenas novos (por chave), com a evidência que os originou
    const newSignals: LiveSignal[] = [];
    for (const d of detected) {
      const existing = this.signals.find((s) => s.kind === d.kind && s.key === d.key);
      if (existing) {
        existing.at = this.now();
        existing.confidence = Math.max(existing.confidence, d.confidence);
        continue;
      }
      const evidence: Evidence = d.seg
        ? { segmentId: d.seg.id, speaker: "customer", text: d.seg.text.slice(0, 500) }
        : { segmentId: null, speaker: null, text: "" };
      const sig: LiveSignal & { at: number } = {
        id: randomUUID(),
        kind: d.kind,
        key: d.key,
        label: d.label,
        confidence: round(d.confidence),
        evidence,
        source: this.deps.decisions ? "jev" : "heuristic",
        createdAt: new Date(this.now()).toISOString(),
        at: this.now(),
      };
      this.signals.push(sig);
      newSignals.push(sig);
      await this.deps.persistence?.signal(stripAt(sig));
    }

    // Cobertura do checklist
    let checklistChanged = false;
    for (const item of this.checklist) {
      const p = covered.get(item.key);
      if (p === undefined) continue;
      const next = p >= 0.7 ? "covered" : p >= 0.4 ? "partial" : item.status;
      if (rank(next) > rank(item.status)) {
        item.status = next;
        checklistChanged = true;
      }
    }

    // Pergunta atual feita pelo profissional → registra e gera aprofundamento
    if (this.current && askedCurrent) {
      await this.resolveCurrent("done", answerIncomplete);
    } else if (
      this.current &&
      newSignals.some((s) => s.kind === "risk") &&
      (this.cooldownPassed() || newSignals.some((s) => s.key === "cancellation_intent"))
    ) {
      // Sinal de risco novo tem prioridade sobre a sugestão atual
      const top = this.rankCandidates()[0];
      if (top && top.candidate.signals.some((k) => newSignals.some((s) => s.key === k))) {
        await this.setStatus(this.current, "replaced");
        this.current = null;
      }
    }
    if (checklistChanged) await this.deps.persistence?.checklist(this.checklist);
    const trigger =
      newSignals.find((s) => s.key === "cancellation_intent") ??
      newSignals.find((s) => s.kind === "risk") ??
      newSignals[0] ??
      null;
    if (!this.current) await this.suggestNext(trigger, "analysis");
    this.emit();
  }

  private async decide(recent: Segment[], freshCustomer: Segment[], openItems: ChecklistItem[]) {
    const riskCriteria = Object.fromEntries([
      ...RISK_SIGNALS.map((s) => [s.key, s.description]),
      ["none", "Nenhum sinal de risco no último trecho"],
    ]);
    const oppCriteria = Object.fromEntries([
      ...OPPORTUNITY_TYPES.map((o) => [o.key, o.description]),
      ["none", "Nenhuma oportunidade de expansão no último trecho"],
    ]);
    const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
      risk: choice(
        "Considerando principalmente a última fala do cliente, qual sinal de risco de churn ela evidencia?",
        riskCriteria,
      ),
      opportunity: choice("A última fala do cliente evidencia alguma oportunidade de expansão?", oppCriteria),
    };
    if (this.current) {
      questions.asked = noul(
        `O profissional de CS já fez a pergunta a seguir (ou uma equivalente) nas falas recentes? Pergunta: "${this.current.question}"`,
      );
      questions.answerComplete = noul(
        `O cliente respondeu de forma completa e específica à pergunta "${this.current.question}"?`,
      );
    }
    openItems.forEach((item, i) => {
      questions[`cov${i}`] = noul(
        `O tema a seguir já foi tratado de forma suficiente na conversa? Tema: "${item.label}"`,
      );
    });
    const r = await this.deps.decisions!.decide({
      state: {
        tipoDeReuniao: this.ctx.meetingType,
        transcricaoRecente: recent.map((s) => ({
          quem: s.speaker === "customer" ? "cliente" : "profissional de CS",
          fala: s.text,
        })),
      },
      questions,
    });
    const a = r.answers as Record<
      string,
      { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }
    >;
    const detected: DetectedSignal[] = [];
    const risk = a.risk;
    // Prudência: só registra sinal com probabilidade relevante; churn exige evidências recorrentes (Etapa 5)
    if (
      risk?.choice &&
      risk.choice !== "none" &&
      (risk.probabilities?.[risk.choice] ?? risk.confidence ?? 0) >= 0.6
    ) {
      const s = RISK_SIGNALS.find((x) => x.key === risk.choice)!;
      detected.push({
        kind: "risk",
        key: s.key,
        label: s.label,
        confidence: risk.probabilities?.[risk.choice] ?? risk.confidence ?? 0.6,
      });
    }
    const opp = a.opportunity;
    if (
      opp?.choice &&
      opp.choice !== "none" &&
      (opp.probabilities?.[opp.choice] ?? opp.confidence ?? 0) >= 0.6
    ) {
      const o = OPPORTUNITY_TYPES.find((x) => x.key === opp.choice)!;
      detected.push({
        kind: "opportunity",
        key: o.key,
        label: o.label,
        confidence: opp.probabilities?.[opp.choice] ?? opp.confidence ?? 0.6,
      });
    }
    const coverage = new Map<string, number>();
    openItems.forEach((item, i) => {
      const v = a[`cov${i}`]?.noul;
      if (typeof v === "number") coverage.set(item.key, v);
    });
    return {
      detected,
      askedCurrent: (a.asked?.noul ?? 0) >= 0.6,
      answerIncomplete: a.answerComplete?.noul !== undefined && a.answerComplete.noul < 0.5,
      coverage,
    };
  }

  private cooldownPassed() {
    return this.now() - this.lastSuggestionAt >= this.ctx.settings.suggestionCooldownSeconds * 1000;
  }

  private activeSignals() {
    return this.signals.filter((s) => this.now() - s.at <= SIGNAL_FRESH_MS);
  }

  /** Pontuação explicável de cada candidata. */
  rankCandidates(): { candidate: Candidate; score: number; matchedSignal: string | null }[] {
    const active = this.activeSignals();
    const riskOpen = this.signals.some((s) => s.kind === "risk");
    const openTopics = new Set(
      this.checklist
        .filter((c) => c.status !== "covered" && c.key.startsWith("topic:"))
        .map((c) => c.key.slice(6)),
    );
    const coveredPb = new Set(
      this.checklist.filter((c) => c.status === "covered" && c.questionKey).map((c) => c.questionKey),
    );
    const elapsedMin = (this.now() - this.startedAt) / 60_000;
    const focus = new Set(this.ctx.settings.focusIndicators);
    const scored: { candidate: Candidate; score: number; matchedSignal: string | null }[] = [];
    for (const c of this.candidates) {
      if (this.used.has(c.key)) continue;
      if (c.playbookQuestionKey && coveredPb.has(c.playbookQuestionKey)) continue;
      if (c.type === "expansion" && riskOpen) continue; // guardrail: não vender com risco aberto
      let score = PRIORITY_SCORE[c.priority];
      // o playbook define a metodologia da empresa: suas perguntas têm precedência sobre a biblioteca
      if (c.source === "playbook") score += 3 + c.weight * 0.3 + (c.required ? 2 : 0);
      if (c.source === "followup") score += 4;
      let matched: string | null = null;
      let best = 0;
      for (const s of active) {
        if (!c.signals.includes(s.key)) continue;
        // sinal presente: gravidade do sinal + prioridade da pergunta (em dobro) + especificidade
        const sev = SEVERITY_BONUS[RISK_SIGNALS.find((r) => r.key === s.key)?.baseSeverity ?? "low"] ?? 0;
        const bonus = 5 + s.confidence + sev + PRIORITY_SCORE[c.priority] + 1 / c.signals.length;
        if (bonus > best) {
          best = bonus;
          matched = s.key;
        }
      }
      score += best;
      for (const t of c.covers) if (openTopics.has(t)) score += 1.5;
      if (c.covers.length && c.covers.every((t) => !openTopics.has(t)) && c.source === "library" && !matched)
        score -= 2;
      if (c.indicator && focus.has(c.indicator)) score += 1;
      if (c.type === "commitment") score += elapsedMin >= 30 ? 3 : -2;
      if (c.signals.length && !matched && c.source === "library") score -= 4; // perguntas reativas só fazem sentido com o sinal presente
      scored.push({ candidate: c, score, matchedSignal: matched });
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  private async suggestNext(
    trigger: (LiveSignal & { at?: number }) | null,
    phase: "prepare" | "analysis" | "manual",
  ) {
    const ranked = this.rankCandidates();
    const top = ranked[0];
    if (!top) {
      this.current = null;
      this.alternatives = [];
      return;
    }
    const signal = top.matchedSignal ? (this.signals.find((s) => s.key === top.matchedSignal) ?? null) : null;
    const s = await this.materialize(top.candidate, signal ?? trigger, phase);
    this.current = s;
    this.used.add(top.candidate.key);
    this.lastSuggestionAt = this.now();
    const alts = ranked.slice(1, 1 + this.ctx.settings.maxAlternativeSuggestions);
    this.alternatives = alts.map((r) => this.baseSuggestion(r.candidate, null));
    await this.deps.persistence?.suggestion(s);
  }

  private baseSuggestion(c: Candidate, signal: LiveSignal | null): Suggestion {
    const reasonParts: string[] = [];
    if (signal?.evidence.text)
      reasonParts.push(
        `O cliente disse: “${signal.evidence.text.slice(0, 160)}” — possível ${signal.label.toLowerCase()}.`,
      );
    reasonParts.push(c.purpose);
    if (c.source === "playbook") reasonParts.push("Pergunta prevista no playbook da empresa.");
    return {
      id: randomUUID(),
      question: c.text,
      reason: reasonParts.join(" "),
      objective: c.purpose,
      type: c.type,
      indicator: c.indicator,
      priority: signal ? "high" : c.priority,
      playbookRef: c.playbookQuestionKey ? { questionKey: c.playbookQuestionKey, text: c.text } : null,
      evidence: signal ? signal.evidence : null,
      candidateKey: c.key,
      status: "shown",
      adaptedBy: null,
      createdAt: new Date(this.now()).toISOString(),
    };
  }

  /** Adapta a pergunta ao que acabou de ser dito (DeepSeek), com fallback para o texto base. */
  private async materialize(c: Candidate, signal: LiveSignal | null, phase: string): Promise<Suggestion> {
    const base = this.baseSuggestion(c, signal);
    if (!this.deps.reasoning || phase === "prepare" || !this.segments.length) return base;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.deps.adaptTimeoutMs ?? 6000);
      const r = await this.deps.reasoning
        .completeJson({
          system: `${renderSkillInstructions(this.ctx.settings)}\n\nTarefa: adaptar UMA pergunta recomendada ao momento da conversa. Mantenha a intenção da pergunta base. Não invente fatos. Responda em JSON {"question","reason","objective"}: question = a pergunta, curta e aberta; reason = por que perguntar agora, citando o que foi dito; objective = o que se quer descobrir.`,
          user: JSON.stringify({
            tipoDeReuniao: this.ctx.meetingType,
            objetivoDaReuniao: this.ctx.objective,
            perguntaBase: c.text,
            proposito: c.purpose,
            origem: c.source === "playbook" ? "playbook da empresa" : "skill de CS",
            sinal: signal ? { tipo: signal.label, evidencia: signal.evidence.text } : null,
            orientacoesDoPlaybook: this.ctx.playbook?.guidelines ?? [],
            transcricaoRecente: this.recent().map(
              (s) => `${s.speaker === "customer" ? "Cliente" : "CS"}: ${s.text}`,
            ),
          }),
          schema: Adapted,
          tier: "fast",
          maxTokens: 400,
          temperature: 0.3,
          signal: ac.signal,
        })
        .finally(() => clearTimeout(timer));
      return {
        ...base,
        question: r.data.question,
        reason: r.data.reason,
        objective: r.data.objective,
        adaptedBy: r.model,
      };
    } catch (err) {
      this.deps.log?.("adaptação indisponível; usando pergunta base", { err: (err as Error).message });
      return base;
    }
  }

  private async setStatus(s: Suggestion, status: Suggestion["status"]) {
    s.status = status;
    await this.deps.persistence?.suggestionStatus(s.id, status);
  }

  private async resolveCurrent(status: "done" | "ignored", deepen = false) {
    const cur = this.current;
    if (!cur) return;
    await this.setStatus(cur, status);
    this.current = null;
    if (status !== "done") return;
    const cand = this.candidates.find((c) => c.key === cur.candidateKey);
    if (cand) {
      // Marca cobertura do item do playbook e dos tópicos da pergunta
      let changed = false;
      for (const item of this.checklist) {
        const hit =
          (cand.playbookQuestionKey && item.questionKey === cand.playbookQuestionKey) ||
          cand.covers.some((t) => item.key === `topic:${t}`);
        if (hit && item.status !== "covered") {
          item.status =
            cand.playbookQuestionKey && item.questionKey === cand.playbookQuestionKey ? "covered" : "partial";
          changed = true;
        }
      }
      if (changed) await this.deps.persistence?.checklist(this.checklist);
      // Cadeia de aprofundamento
      const next = cand.followUps[0];
      if (next && (deepen || cand.followUps.length)) {
        this.candidates.push({
          ...cand,
          key: `${cand.key}#f${cand.key.split("#f").length}`,
          text: next,
          type: "deepening",
          purpose: `Aprofundar a resposta sobre: ${cand.text}`,
          source: "followup",
          followUps: cand.followUps.slice(1),
          playbookQuestionKey: cand.playbookQuestionKey,
          required: false,
          signals: cand.signals,
          priority: deepen ? "high" : cand.priority,
        });
      }
    }
  }

  // Ações do profissional ------------------------------------------------------
  async markDone(id: string) {
    if (this.current?.id !== id) return this.state();
    await this.resolveCurrent("done");
    await this.suggestNext(null, "manual");
    this.emit();
    return this.state();
  }

  async ignore(id: string) {
    if (this.current?.id !== id) return this.state();
    await this.resolveCurrent("ignored");
    await this.suggestNext(null, "manual");
    this.emit();
    return this.state();
  }

  async requestAnother() {
    if (this.current) {
      await this.setStatus(this.current, "replaced");
      this.current = null;
    }
    await this.suggestNext(null, "manual");
    this.emit();
    return this.state();
  }

  /** Itens ainda não investigados (para a ação "visualizar informações ainda não investigadas"). */
  openItems() {
    return this.checklist.filter((c) => c.status !== "covered");
  }
}

function rank(s: ChecklistItem["status"]) {
  return s === "covered" ? 2 : s === "partial" ? 1 : 0;
}
function round(n: number) {
  return Math.round(n * 100) / 100;
}
function stripAt(s: LiveSignal & { at: number }): LiveSignal {
  const { at: _at, ...rest } = s;
  return rest;
}
/** Semelhança simples por sobreposição de palavras (modo degradado). */
export function similar(a: string, b: string): boolean {
  const wa = new Set(
    normalize(a)
      .split(" ")
      .filter((w) => w.length > 3),
  );
  const wb = normalize(b)
    .split(" ")
    .filter((w) => w.length > 3);
  if (!wb.length) return false;
  const inter = wb.filter((w) => wa.has(w)).length;
  return inter / wb.length >= 0.6;
}
