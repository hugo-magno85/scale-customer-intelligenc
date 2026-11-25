import type { QuestionType } from "@sci/contracts";

export const QUESTION_TYPE_KNOWLEDGE: Record<QuestionType, { description: string; whenToUse: string }> = {
  diagnosis: {
    description: "Entender a situação atual e a causa raiz.",
    whenToUse: "Início de um tema ou quando surge um problema ainda vago.",
  },
  deepening: {
    description: "Aprofundar uma resposta: extensão, frequência, impacto, exemplos.",
    whenToUse: "Logo após uma resposta incompleta ou genérica.",
  },
  validation: {
    description: "Confirmar entendimento ou hipótese com o cliente.",
    whenToUse: "Antes de registrar conclusão relevante ou próximo passo.",
  },
  needs: {
    description: "Descobrir necessidades explícitas e implícitas.",
    whenToUse: "Quando o cliente descreve dificuldades ou objetivos novos.",
  },
  value_perception: {
    description: "Medir o resultado percebido e a conexão com objetivos.",
    whenToUse: "Revisões, renovação, ou quando surgem dúvidas sobre investimento.",
  },
  satisfaction: {
    description: "Avaliar satisfação com produto, serviço e relacionamento.",
    whenToUse: "Reuniões de acompanhamento e satisfação.",
  },
  adoption: {
    description: "Entender uso real, por quem, e barreiras.",
    whenToUse: "Onboarding, implantação e sinais de baixo uso.",
  },
  expectations: {
    description: "Explicitar e alinhar expectativas, metas e prazos.",
    whenToUse: "Onboarding, mudanças de escopo ou sinais de frustração.",
  },
  risk: {
    description: "Investigar sinais de risco com cuidado e sem induzir.",
    whenToUse: "Quando aparece um sinal de churn.",
  },
  retention: {
    description: "Construir caminho para continuidade e renovação.",
    whenToUse: "Clientes em risco ou perto da renovação.",
  },
  expansion: {
    description: "Explorar novas necessidades e potencial de ampliação.",
    whenToUse: "Somente com valor atual reconhecido.",
  },
  commitment: {
    description: "Fechar próximos passos com responsáveis e prazos.",
    whenToUse: "Final de cada tema importante e final da reunião.",
  },
};
