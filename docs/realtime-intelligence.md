# Inteligência de perguntas em tempo real (Etapa 4)

O Scale Assistant não segue um roteiro fixo: a cada fala relevante ele decide **qual é a próxima
pergunta mais importante**, explica o porquê e mostra a evidência. O profissional decide e conduz.

## Motor de decisão (`packages/intelligence/src/realtime`)

| Etapa               | O que faz                                                                                                                                         | Provedor                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Banco de candidatas | Perguntas do playbook publicado (precedência) + biblioteca da skill filtrada por tipo de reunião e tipos habilitados no tenant                    | —                                                                   |
| Checklist           | Perguntas do playbook + tópicos obrigatórios do tipo de reunião (ex.: próximos passos)                                                            | —                                                                   |
| Sinais              | Risco (10 tipos) e oportunidade (8 tipos) na última fala do cliente, com probabilidade mínima de 0,6                                              | **Jev** (`choice`) — heurística pt-BR em modo degradado             |
| Cobertura           | “Este tema já foi tratado?” para até 8 itens abertos por ciclo                                                                                    | **Jev** (`noul`)                                                    |
| Pergunta feita?     | Detecta se o profissional fez a pergunta atual (ou equivalente) e se a resposta foi completa                                                      | **Jev** / similaridade                                              |
| Ranking             | Pontuação explicável: prioridade, peso do playbook, obrigatoriedade, sinal ativo, lacunas, prioridades estratégicas do tenant, momento da reunião | código                                                              |
| Adaptação           | Reescreve a pergunta escolhida para o momento da conversa, com motivo e objetivo                                                                  | **DeepSeek** (tier rápido, timeout 6 s, fallback para o texto base) |

Regras de prudência aplicadas no código:

- Expansão nunca é sugerida enquanto houver sinal de risco aberto.
- Perguntas reativas (de sinal) só entram com o sinal presente.
- Sinal novo de risco pode substituir a sugestão atual, respeitando o intervalo mínimo configurado.
- Nenhuma pergunta é repetida; ignoradas não voltam.
- Cada sugestão registra versão da skill (na reunião), referência ao playbook e evidência com o id do segmento.

## Fluxo

- **Preparação** (`GET /v1/meetings/:id/intelligence`): primeira pergunta, checklist, pontos a investigar
  (objetivo do tipo de reunião, objetivo definido, o que evitar, histórico de riscos do cliente, orientações do playbook).
- **Copiloto**: cada segmento final da transcrição alimenta o motor (debounce de 1,2 s, análises nunca sobrepostas);
  mudanças são enviadas ao painel pelo mesmo WebSocket (`type: "intelligence"`).
- **Ações**: marcar como realizada (gera o aprofundamento em cadeia), ignorar, outra pergunta, registrar
  observação, consultar playbook, ver o que ainda não foi investigado.
- Estado persistido em `intelligence_suggestions`, `meeting_live_signals`, `meeting_notes` e `meetings.checklist`;
  restaurado após reconexão ou reinício.

## Validação

- 25 testes do motor, incluindo o exemplo de referência (baixa adoção → pergunta → aprofundamento em cadeia),
  prudência com Jev, fallback do DeepSeek por tempo, precedência do playbook, persistência.
- API: preparação, ações, restauração, permissões, isolamento entre tenants e o fluxo transcrição → sinal → pergunta via WebSocket.
- Chromium real com a extensão: painel exibindo a pergunta, motivo, objetivo, indicador, prioridade e evidência.
- Pendente: calibrar limiares com Jev e DeepSeek reais e transcrições reais da Academia Scale.
