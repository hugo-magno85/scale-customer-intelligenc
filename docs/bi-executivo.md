# BI Executivo — Customer Intelligence

Dashboard em `/app/dashboard`, alimentado por `GET /v1/reports/bi` (permissão `reports.read`).
A página antiga de relatórios (`/app/relatorios`, `GET /v1/reports/overview` e exportações CSV) continua igual.

## Regras de integridade

- Só dados reais do tenant (RLS). Nenhum número é estimado ou simulado.
- `null` = indisponível. A tela mostra "—" e o motivo; nunca troca por zero.
- Zero real (ex.: nenhuma ação atrasada) aparece como 0.
- Comparativos só entre períodos do mesmo tamanho:
  - **vs. período anterior**: o intervalo imediatamente antes, com o mesmo número de dias;
  - **vs. ano anterior**: as mesmas datas, um ano antes.
- Sem histórico no período de comparação, a variação mostra "Histórico insuficiente".
- Clientes não são duplicados: receita em risco conta uma vez por cliente, e reuniões com várias versões de análise contam uma vez.
- Todos os filtros globais (período, responsável, segmento, playbook, saúde, risco) valem para todos os blocos.

## "Como estava em uma data"

Indicadores de estoque (Customer Health, saudáveis, em atenção, risco alto) usam a **última nota de Customer Health de cada cliente até a data**, tirada de `customer_health_snapshots`. Isso permite:

- o valor ao fim do período;
- o comparativo com o fim do período de comparação;
- a sparkline (fim de cada semana ou mês);
- o velocímetro: fim do mês anterior e a mesma data no ano anterior;
- a movimentação de risco (início × fim do período).

Ações pendentes e atrasadas em uma data são reconstruídas a partir de `action_tasks`:

- `created_at` (criação);
- `completed_at` (conclusão);
- `updated_at`, nas canceladas.

## Mapa dos indicadores

| Indicador                           | Fonte                                                                                          | Comparativo                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Clientes ativos                     | `customers.status = active`                                                                    | **Indisponível**: não há histórico de entrada e saída de clientes                |
| Customer Health médio / velocímetro | snapshots (último até a data), exibido de 0 a 10                                               | Sim, quando há nota antes do fim do período de comparação                        |
| Saudáveis / Atenção / Risco alto    | classificação do último snapshot até a data; % sobre os clientes com nota                      | Sim (idem)                                                                       |
| Receita em risco                    | `churn_signals` abertos com `revenue_at_risk_cents` (máximo por cliente)                       | **Indisponível**: sinais não guardam histórico de abertura e fechamento por data |
| Oportunidades de expansão           | abertas e qualificadas agora; a variação compara as **identificadas** em cada período          | Sim, a partir da primeira reunião registrada                                     |
| Reuniões analisadas                 | reuniões do período com análise `completed` (distintas)                                        | Sim, a partir da primeira reunião registrada                                     |
| Planos pendentes / atrasados        | `action_tasks` reconstruídas na data                                                           | Sim, quando já existiam ações na data de comparação                              |
| Receita recuperada                  | `mrr_cents` dos clientes que estavam em risco alto no início e saíram dessa faixa no fim       | Só com nota no início e no fim; sem receita cadastrada, "—"                      |
| Fatores de risco                    | `churn_signals` abertos por fator (clientes distintos) e novos por `first_seen_at`             | Novos no período × comparação                                                    |
| Expansão convertida                 | oportunidades `won`, pela data de atualização                                                  | Período × comparação                                                             |
| Taxa de conclusão                   | ações concluídas ÷ criadas no período (sem as canceladas)                                      | Período × comparação                                                             |
| Tempo médio de conclusão            | `completed_at − created_at` das concluídas no período                                          | Só com conclusões no período                                                     |
| Média dos indicadores               | `intelligence_indicators` das reuniões do período (0 a 10). Risco de churn: quanto maior, pior | Período × comparação                                                             |

## Faixas do velocímetro

Vêm das regras do tenant (Configurações → Customer Health), em 0–100 e exibidas em 0–10:

- **crítico**: abaixo de `attentionMin` (padrão 4,0);
- **atenção**: de `attentionMin` até `healthyMin` (padrão 7,0);
- **saudável**: a partir de `healthyMin`;
- **excelente**: a partir de `excellentMin`.

`excellentMin` é opcional e serve só para o visual. O padrão é 8,0, ou o meio do caminho até 10 quando a faixa saudável já começa em 8 ou mais. A classificação dos clientes (saudável / atenção / risco alto) não muda.

## Drill-down

Cada KPI e cada fatia da distribuição abre a lista dos clientes relacionados:

- a lista mostra a situação atual de cada cliente;
- cada linha leva à ficha do cliente, que tem o histórico do Customer Health;
- "Reuniões analisadas" leva para Calls;
- os fatores de risco mostram os clientes impactados com link para a ficha.

## Limitações conhecidas

- Clientes ativos e receita em risco não têm comparativo histórico. Para isso seria preciso registrar mudanças de status do cliente e de abertura e fechamento dos sinais. Ficam como evolução futura, sem mudança de banco nesta entrega.
- "Convertidas" usa a data da última atualização da oportunidade com status `won`.
- A lista do drill-down mostra a situação atual mesmo quando o período termina no passado. Os KPIs mostram a situação ao fim do período.
