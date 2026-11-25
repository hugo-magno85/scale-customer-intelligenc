import { NEED_CATEGORIES, OPPORTUNITY_TYPES, RISK_SIGNALS } from "@sci/cs-skill";
import type { SignalKind } from "@sci/contracts";
import { normalize } from "./candidates.js";

export interface DetectedSignal {
  kind: SignalKind;
  key: string;
  label: string;
  confidence: number;
}

/** Palavras-chave adicionais (pt-BR) para o modo degradado, sem modelo de IA. */
const EXTRA: Record<string, string[]> = {
  low_adoption: [
    "usando pouco",
    "nao se adaptou",
    "nao conseguiu se adaptar",
    "ninguem usa",
    "pouco uso",
    "voltaram para a planilha",
  ],
  dissatisfaction: ["insatisfeit", "decepcionad", "frustrad", "deixando a desejar", "esperava mais"],
  recurring_complaints: [
    "de novo",
    "mais uma vez",
    "continua acontecendo",
    "sempre acontece",
    "ja falamos disso",
  ],
  no_value_perception: [
    "nao vimos resultado",
    "nao sei se vale",
    "valendo a pena",
    "esta caro",
    "sem retorno",
  ],
  unmet_expectations: ["nos venderam", "foi prometido", "nao era isso", "achavamos que"],
  loss_of_trust: ["nao da para confiar", "nao confio", "prometem e nao cumprem", "por escrito"],
  implementation_problems: ["implantacao", "travad", "atrasad", "nao integramos", "integracao nao"],
  relationship_issues: ["saiu da empresa", "novo diretor", "sem retorno de voces", "atendimento piorou"],
  cancellation_intent: [
    "cancelar",
    "cancelamento",
    "nao vamos renovar",
    "outra ferramenta",
    "outro fornecedor",
    "concorrente",
    "encerrar o contrato",
  ],
  no_progress: ["nao avancou", "ficou parado", "igual a ultima vez", "nao conseguimos avancar"],
  upsell: ["no limite", "precisariamos de mais", "plano maior"],
  cross_sell: ["voces tambem fazem", "teria algo para"],
  new_need: ["novo desafio", "agora estamos com dificuldade", "precisamos resolver"],
  new_area: [
    "outra area",
    "outra filial",
    "filial do",
    "outro time",
    "outro departamento",
    "quer comecar a usar",
    "tambem quer usar",
  ],
  more_users: ["vamos contratar", "mais gente", "mais usuarios", "equipe vai crescer"],
  new_product: ["lancamento", "previsao de", "novo modulo"],
  additional_services: ["treinamento ajudaria", "consultoria", "precisariamos de ajuda"],
  scope_increase: ["incluir tambem", "estender para", "ampliar o escopo"],
};

/** Detecção por palavras-chave — usada quando o Jev não está disponível. Confiança fixa e moderada. */
export function detectHeuristic(text: string): DetectedSignal[] {
  const t = normalize(text);
  const out: DetectedSignal[] = [];
  const hit = (key: string, examples: readonly string[]) =>
    [...examples.map(normalize), ...(EXTRA[key] ?? [])].some((p) => p.length > 3 && t.includes(p));
  for (const s of RISK_SIGNALS)
    if (hit(s.key, s.examples)) out.push({ kind: "risk", key: s.key, label: s.label, confidence: 0.55 });
  for (const o of OPPORTUNITY_TYPES)
    if (hit(o.key, o.examples))
      out.push({ kind: "opportunity", key: o.key, label: o.label, confidence: 0.5 });
  void NEED_CATEGORIES;
  return out;
}
