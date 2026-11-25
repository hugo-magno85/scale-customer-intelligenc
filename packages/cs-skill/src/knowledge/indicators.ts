import type { Indicator } from "@sci/contracts";

export interface IndicatorKnowledge {
  key: Indicator;
  description: string;
  /** Sinais na conversa que elevam o indicador. */
  positiveCues: string[];
  /** Sinais na conversa que reduzem o indicador. */
  negativeCues: string[];
  /** Rubrica 0–4 usada pelas decisões tipadas (Jev) e pelo pós-call. */
  rubric: [string, string, string, string, string];
  /** true quando valores maiores significam pior situação. */
  inverted: boolean;
}

export const INDICATOR_KNOWLEDGE: IndicatorKnowledge[] = [
  {
    key: "satisfaction",
    description: "Quão satisfeito o cliente está com o produto/serviço e com o atendimento.",
    positiveCues: ["elogios espontâneos", "recomendação a terceiros", "comparação favorável com antes"],
    negativeCues: ["reclamações", "frustração com suporte", "comparações desfavoráveis", "tom de cobrança"],
    rubric: [
      "muito insatisfeito",
      "insatisfeito",
      "neutro ou misto",
      "satisfeito",
      "muito satisfeito, promotor",
    ],
    inverted: false,
  },
  {
    key: "trust",
    description: "Confiança do cliente na empresa, no time e nas promessas feitas.",
    positiveCues: ["compartilha dados e planos internos", "pede opinião estratégica", "cumpre combinados"],
    negativeCues: [
      "questiona promessas da venda",
      "pede tudo por escrito",
      "menciona experiências quebradas",
      "desconfia de prazos",
    ],
    rubric: [
      "confiança rompida",
      "confiança baixa",
      "confiança condicionada",
      "confiança boa",
      "parceria de confiança",
    ],
    inverted: false,
  },
  {
    key: "engagement",
    description: "Disposição do cliente em participar, responder e investir tempo no relacionamento.",
    positiveCues: ["traz pauta própria", "envolve outras pessoas", "responde em detalhe", "assume tarefas"],
    negativeCues: [
      "respostas monossilábicas",
      "remarca reuniões",
      "delegou para alguém sem poder",
      "não assume próximos passos",
    ],
    rubric: [
      "desengajado",
      "pouco engajado",
      "engajamento reativo",
      "engajado",
      "altamente engajado e proativo",
    ],
    inverted: false,
  },
  {
    key: "value_perception",
    description: "Quanto o cliente reconhece resultado de negócio gerado pela solução.",
    positiveCues: [
      "cita resultado mensurável",
      "atribui ganho à solução",
      "fala em retorno sobre investimento",
    ],
    negativeCues: [
      "não sabe dizer o que ganhou",
      "questiona o preço",
      "considera a solução custo",
      "compara com alternativa mais barata",
    ],
    rubric: [
      "não percebe valor",
      "valor duvidoso",
      "valor parcial ou genérico",
      "valor claro",
      "valor claro e mensurado",
    ],
    inverted: false,
  },
  {
    key: "adoption",
    description: "Uso efetivo da solução pelas pessoas e processos previstos.",
    positiveCues: ["uso no dia a dia", "processos migrados", "novos usuários pedindo acesso"],
    negativeCues: [
      "equipe não se adaptou",
      "uso concentrado em poucos",
      "voltaram ao processo antigo",
      "funcionalidades-chave sem uso",
    ],
    rubric: ["sem uso relevante", "uso baixo", "uso parcial", "uso consistente", "uso amplo e maduro"],
    inverted: false,
  },
  {
    key: "expectation_alignment",
    description: "Alinhamento entre o que o cliente espera e o que foi contratado/entregue.",
    positiveCues: ["expectativas coerentes com o escopo", "metas compartilhadas e datadas"],
    negativeCues: [
      "'nos venderam que...'",
      "espera algo fora do escopo",
      "prazos irreais",
      "objetivos indefinidos",
    ],
    rubric: [
      "desalinhamento grave",
      "desalinhamento relevante",
      "pontos a alinhar",
      "alinhado",
      "totalmente alinhado com metas claras",
    ],
    inverted: false,
  },
  {
    key: "churn_risk",
    description:
      "Probabilidade de o cliente cancelar ou não renovar. Exige evidências recorrentes ou graves.",
    positiveCues: [],
    negativeCues: [
      "intenção explícita de cancelar",
      "avaliando concorrentes",
      "corte de orçamento",
      "patrocinador saiu",
      "insatisfação recorrente sem plano",
    ],
    rubric: [
      "sem sinais de risco",
      "sinais leves e isolados",
      "sinais relevantes",
      "risco alto",
      "intenção explícita de cancelar",
    ],
    inverted: true,
  },
  {
    key: "expansion_opportunity",
    description: "Potencial de ampliar receita (upsell, cross-sell, mais usuários, novas áreas).",
    positiveCues: [
      "nova necessidade",
      "nova área interessada",
      "crescimento de equipe",
      "pergunta sobre outros produtos",
    ],
    negativeCues: ["restrição de orçamento", "valor atual não reconhecido"],
    rubric: [
      "sem oportunidade",
      "interesse vago",
      "necessidade identificada",
      "oportunidade qualificada",
      "pedido explícito de ampliação",
    ],
    inverted: false,
  },
];
