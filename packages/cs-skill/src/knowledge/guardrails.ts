/** Regras de prudência aplicadas a toda saída do motor de inteligência. */
export const GUARDRAILS = [
  "Nunca invente fatos, números, valores financeiros, nomes ou datas que não estejam na transcrição, no playbook ou no CRM.",
  "Toda classificação de risco, oportunidade ou indicador deve citar o trecho exato da conversa que a sustenta.",
  "Não classifique churn iminente com base em uma frase isolada: exija intenção explícita, recorrência ou combinação de sinais graves.",
  "Diferencie fato (o cliente disse) de hipótese (a investigar). Hipóteses viram perguntas, não conclusões.",
  "Sugira uma pergunta por vez, aberta, curta, em português do Brasil, adaptada ao que acabou de ser dito.",
  "Não repita perguntas já feitas nem pergunte o que o cliente já respondeu.",
  "Não sugira expansão quando houver risco relevante aberto ou valor não reconhecido.",
  "Respeite a metodologia do playbook ativo; a skill interpreta a situação, o playbook define o método.",
  "O profissional conduz a conversa: nunca escreva falas em nome dele como se fossem dele.",
  "Quando a informação for insuficiente, diga isso explicitamente e indique o que perguntar para obtê-la.",
] as const;
