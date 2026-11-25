import type { Indicator } from "@sci/contracts";

export type Severity = "low" | "medium" | "high" | "critical";

export interface RiskSignalKnowledge {
  key: string;
  label: string;
  description: string;
  /** Exemplos de falas que costumam indicar o sinal. */
  examples: string[];
  indicators: Indicator[];
  /** Severidade base; o motor ajusta por recorrência, falante e histórico. */
  baseSeverity: Severity;
  /** O que precisa ser investigado antes de concluir. */
  investigate: string[];
}

/** Sinais de churn (Churn Radar). */
export const RISK_SIGNALS: RiskSignalKnowledge[] = [
  {
    key: "low_adoption",
    label: "Baixa adoção",
    description: "A solução é pouco usada ou usada por poucas pessoas.",
    examples: ["estamos usando pouco", "a equipe ainda não se adaptou", "só eu entro no sistema"],
    indicators: ["adoption", "churn_risk"],
    baseSeverity: "medium",
    investigate: [
      "quais funcionalidades",
      "quantas pessoas/áreas",
      "causa (treinamento, usabilidade, processo, prioridade)",
      "impacto no resultado",
    ],
  },
  {
    key: "dissatisfaction",
    label: "Insatisfação",
    description: "O cliente expressa descontentamento com produto, serviço ou atendimento.",
    examples: ["não estou satisfeito", "esperava mais", "está deixando a desejar"],
    indicators: ["satisfaction", "churn_risk"],
    baseSeverity: "medium",
    investigate: ["origem da insatisfação", "desde quando", "quem mais compartilha", "o que resolveria"],
  },
  {
    key: "recurring_complaints",
    label: "Reclamações recorrentes",
    description: "O mesmo problema aparece repetidamente nesta e/ou em reuniões anteriores.",
    examples: ["de novo esse problema", "já falamos disso antes", "continua acontecendo"],
    indicators: ["satisfaction", "trust", "churn_risk"],
    baseSeverity: "high",
    investigate: ["frequência", "impacto operacional", "o que já foi tentado", "prazo esperado de solução"],
  },
  {
    key: "no_value_perception",
    label: "Falta de percepção de valor",
    description: "O cliente não reconhece o resultado gerado ou questiona o investimento.",
    examples: ["não sei se está valendo a pena", "não vimos resultado", "está caro para o que entrega"],
    indicators: ["value_perception", "churn_risk"],
    baseSeverity: "high",
    investigate: [
      "objetivos originais",
      "métricas acompanhadas",
      "resultados obtidos mesmo que parciais",
      "o que seria sucesso",
    ],
  },
  {
    key: "unmet_expectations",
    label: "Expectativas não atendidas",
    description: "Há diferença entre o que o cliente esperava e o que recebeu.",
    examples: ["nos venderam que", "achávamos que faria", "não era isso que combinamos"],
    indicators: ["expectation_alignment", "trust", "churn_risk"],
    baseSeverity: "high",
    investigate: [
      "expectativa exata",
      "origem (venda, onboarding)",
      "se está no escopo",
      "alternativas aceitáveis",
    ],
  },
  {
    key: "loss_of_trust",
    label: "Perda de confiança",
    description: "O cliente duvida das promessas, prazos ou competência do time.",
    examples: ["não dá mais para confiar", "sempre prometem e não cumprem", "quero isso por escrito"],
    indicators: ["trust", "churn_risk"],
    baseSeverity: "high",
    investigate: [
      "episódios que geraram a desconfiança",
      "quem está envolvido",
      "o que restauraria a confiança",
    ],
  },
  {
    key: "implementation_problems",
    label: "Problemas de implantação",
    description: "Atrasos, bloqueios técnicos ou de processo na implantação.",
    examples: ["a implantação está travada", "ainda não integramos", "estamos atrasados"],
    indicators: ["adoption", "expectation_alignment", "churn_risk"],
    baseSeverity: "medium",
    investigate: [
      "bloqueio específico",
      "responsável pelo desbloqueio",
      "dependências do cliente",
      "nova data realista",
    ],
  },
  {
    key: "relationship_issues",
    label: "Dificuldades de relacionamento",
    description: "Atritos com o time, troca de contato, patrocinador ausente ou saída do decisor.",
    examples: ["o diretor que contratou saiu", "não temos retorno de vocês", "o atendimento piorou"],
    indicators: ["trust", "engagement", "churn_risk"],
    baseSeverity: "medium",
    investigate: [
      "novo patrocinador/decisor",
      "canais e frequência de contato",
      "expectativa sobre o atendimento",
    ],
  },
  {
    key: "cancellation_intent",
    label: "Intenção de cancelamento",
    description: "O cliente menciona cancelar, não renovar, reduzir ou trocar de fornecedor.",
    examples: ["estamos pensando em cancelar", "não vamos renovar", "estamos avaliando outra ferramenta"],
    indicators: ["churn_risk"],
    baseSeverity: "critical",
    investigate: [
      "motivo principal",
      "quem decide e quando",
      "alternativa considerada",
      "condições para continuar",
    ],
  },
  {
    key: "no_progress",
    label: "Ausência de evolução",
    description: "Os mesmos pontos sem avanço entre reuniões; planos de ação parados.",
    examples: ["está igual à última vez", "não conseguimos avançar", "ficou parado"],
    indicators: ["engagement", "churn_risk"],
    baseSeverity: "medium",
    investigate: ["o que impediu o avanço", "prioridade interna do tema", "compromisso realista"],
  },
];

export interface OpportunityKnowledge {
  key: string;
  label: string;
  description: string;
  examples: string[];
  /** Condição para explorar (o valor atual precisa estar reconhecido). */
  precondition: string;
}

/** Oportunidades de expansão (Customer Growth). */
export const OPPORTUNITY_TYPES: OpportunityKnowledge[] = [
  {
    key: "upsell",
    label: "Upsell",
    description: "Plano superior ou mais capacidade do mesmo produto.",
    examples: ["estamos no limite", "precisaríamos de mais"],
    precondition: "valor atual reconhecido",
  },
  {
    key: "cross_sell",
    label: "Cross-sell",
    description: "Outro produto ou serviço do portfólio.",
    examples: ["vocês também fazem", "teria algo para"],
    precondition: "valor atual reconhecido",
  },
  {
    key: "new_need",
    label: "Nova necessidade",
    description: "Problema novo que a empresa pode resolver.",
    examples: ["agora estamos com dificuldade em", "um novo desafio é"],
    precondition: "necessidade confirmada pelo cliente",
  },
  {
    key: "new_area",
    label: "Nova área de utilização",
    description: "Outra área/unidade pode usar a solução.",
    examples: ["o time de outra área viu e gostou", "outra filial"],
    precondition: "patrocinador na nova área",
  },
  {
    key: "more_users",
    label: "Expansão de usuários",
    description: "Mais pessoas precisam de acesso.",
    examples: ["vamos contratar", "mais gente quer usar"],
    precondition: "adoção atual saudável",
  },
  {
    key: "new_product",
    label: "Novos produtos",
    description: "Interesse em lançamentos ou módulos.",
    examples: ["vi que lançaram", "tem previsão de"],
    precondition: "interesse explícito",
  },
  {
    key: "additional_services",
    label: "Serviços adicionais",
    description: "Consultoria, treinamento, suporte premium.",
    examples: ["precisaríamos de ajuda para", "um treinamento ajudaria"],
    precondition: "necessidade confirmada",
  },
  {
    key: "scope_increase",
    label: "Aumento de escopo",
    description: "Ampliar o escopo contratado.",
    examples: ["queremos incluir também", "dá para estender para"],
    precondition: "valor atual reconhecido",
  },
];

/** Categorias de necessidades do cliente. */
export const NEED_CATEGORIES = [
  "treinamento e capacitação",
  "suporte e atendimento",
  "funcionalidade ou ajuste de produto",
  "integração e dados",
  "processo e governança",
  "comunicação de valor e resultados",
  "estratégia e metas",
] as const;
