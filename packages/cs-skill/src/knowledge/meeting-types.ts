import type { MeetingType } from "@sci/contracts";

/** Tópicos de cobertura usados no checklist "o que ainda não foi investigado". */
export const COVERAGE_TOPICS = {
  objectives: "Objetivos e prioridades atuais do cliente",
  value: "Resultados percebidos e valor",
  adoption: "Uso e adoção da solução",
  satisfaction: "Satisfação com produto e atendimento",
  expectations: "Expectativas, metas e prazos",
  stakeholders: "Pessoas envolvidas e decisores",
  risk: "Riscos e pontos de atenção",
  needs: "Necessidades novas",
  expansion: "Potencial de expansão",
  next_steps: "Próximos passos com responsáveis e prazos",
} as const;
export type CoverageTopic = keyof typeof COVERAGE_TOPICS;

export const MEETING_TYPE_KNOWLEDGE: Record<
  MeetingType,
  { objective: string; mustCover: CoverageTopic[]; avoid?: string }
> = {
  onboarding: {
    objective: "Alinhar objetivos, critérios de sucesso, plano de implantação e o primeiro marco de valor.",
    mustCover: ["objectives", "expectations", "stakeholders", "adoption", "next_steps"],
    avoid: "Explorar expansão antes do primeiro valor entregue.",
  },
  follow_up: {
    objective: "Acompanhar evolução, adoção e satisfação; detectar riscos e necessidades cedo.",
    mustCover: ["value", "adoption", "satisfaction", "needs", "next_steps"],
  },
  results_review: {
    objective: "Demonstrar e validar resultados frente aos objetivos; redefinir metas.",
    mustCover: ["objectives", "value", "expectations", "next_steps"],
  },
  satisfaction: {
    objective: "Entender a satisfação em profundidade e as causas de insatisfação.",
    mustCover: ["satisfaction", "value", "risk", "next_steps"],
  },
  at_risk_recovery: {
    objective: "Entender a causa do risco, reconstruir confiança e acordar um plano de recuperação.",
    mustCover: ["risk", "expectations", "stakeholders", "next_steps"],
    avoid: "Oferecer expansão ou vender durante a recuperação.",
  },
  retention: {
    objective: "Garantir a continuidade/renovação com valor reconhecido e objeções tratadas.",
    mustCover: ["value", "risk", "stakeholders", "next_steps"],
  },
  expansion: {
    objective: "Qualificar novas necessidades e oportunidades de ampliação.",
    mustCover: ["value", "needs", "expansion", "stakeholders", "next_steps"],
  },
  executive_review: {
    objective: "Alinhar com a liderança resultados, estratégia e prioridades do próximo ciclo.",
    mustCover: ["objectives", "value", "stakeholders", "expansion", "next_steps"],
  },
  other: {
    objective: "Conduzir a reunião com foco em valor, riscos e próximos passos.",
    mustCover: ["objectives", "next_steps"],
  },
};
