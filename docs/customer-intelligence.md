# Customer Intelligence (Etapa 5)

Interpreta **exclusivamente** o que foi dito nas reuniões (e, na Etapa 7, o contexto do CRM).

## Modo Análise

Ao encerrar uma reunião com transcrição, uma análise versionada é enfileirada (`sci.analysis`) e o worker:

1. Reúne transcrição (segmentos numerados), sinais ao vivo, perguntas realizadas, observações, checklist,
   playbook usado e sinais de churn já abertos do cliente.
2. **DeepSeek** (tier de raciocínio) produz resumo, diagnóstico, objetivos, perguntas feitas e não respondidas,
   necessidades, feedbacks, 8 indicadores (rubrica 0–4), riscos, oportunidades e ações — sempre citando ids de segmento.
3. O **código** troca ids por citações reais do banco (o modelo não escreve a evidência), descarta itens sem
   evidência, exige que riscos/oportunidades venham de falas do cliente e aplica as regras de prudência.
4. **Jev** confere de forma independente se as falas sustentam cada risco/oportunidade (descarta abaixo de 0,5).
5. Grava indicadores, Customer Health, Churn Radar, oportunidades e plano de ação. Reanalisar gera nova versão;
   tarefas pendentes e oportunidades abertas da versão anterior são substituídas.

Sem DeepSeek configurado, roda a **análise básica**: riscos/oportunidades a partir dos sinais ao vivo com evidência,
sem indicadores e sem Customer Health — e diz isso explicitamente.

## Regras de prudência (código, testadas)

- Indicador sem evidência = nota nula (o banco rejeita nota sem evidência).
- Risco de churn: nota 4 só com intenção explícita; nota ≥ 3 exige ≥ 2 fatores distintos ou recorrência.
- Severidade: “crítico” só com intenção de cancelamento ou recorrência ≥ 3; recorrência eleva um nível;
  uma única fala não vira “alto” (exceto intenção de cancelar).
- Com risco aberto, oportunidades ficam para depois e ações de upsell/expansão não entram no plano.
- Valores financeiros: receita em risco só quando o cliente tem receita informada (manual/CRM) e o sinal é alto/crítico,
  contada uma vez por cliente; potencial de expansão só quando uma pessoa informa.

## Customer Health

Média ponderada (pesos por tenant em Configurações → Customer Health) de adoção, engajamento, satisfação, confiança,
percepção de valor e alinhamento de expectativas — só os que têm evidência, com pesos redistribuídos. Suavizada pelo
histórico (padrão 30%). Mínimo de 3 indicadores; abaixo disso a nota é nula. Classificação: saudável ≥ 70, atenção ≥ 40,
risco alto < 40; sinal crítico aberto força “risco alto” e sinal alto limita a “atenção”. Cada snapshot guarda fatores
(impacto relativo a um cliente neutro), indicadores ausentes, travas aplicadas e os pesos usados.

## Telas

Customer Health (carteira ordenada por risco), Churn Radar (evidência, recorrência, recomendação, próxima ação,
receita em risco), Oportunidades de Expansão, Planos de Ação (status “Atrasado” derivado do prazo), análise completa
na reunião e saúde/evolução no perfil do cliente. Dashboard com números reais e links para o detalhe.
