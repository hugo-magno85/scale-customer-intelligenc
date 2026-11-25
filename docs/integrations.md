# Integrações

| Serviço                                       | Papel                                                                                      | Etapa | Situação                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| DeepSeek                                      | Interpretação de playbooks, raciocínio, redação de perguntas e análises                    | 2     | Cliente a implementar; requer `DEEPSEEK_API_KEY`                                                                        |
| TypeSafe Jev (`@typesafe-ai/sdk`)             | Decisões tipadas: classificação de sinais, cobertura de checklist, prioridade, verificação | 2     | SDK avaliado (v0.7.0: perguntas `noul`, `choice`, `score` com probabilidades); requer `TYPESAFE_API_KEY` (early access) |
| Deepgram                                      | Transcrição em streaming pt-BR, multicanal                                                 | 3     | Requer `DEEPGRAM_API_KEY`                                                                                               |
| Bitrix24, Pipedrive, RD Station CRM, Zoho CRM | Contexto do cliente e publicação de resultados                                             | 7     | Por último, conforme definido                                                                                           |

Regra: uma integração só é considerada funcional após autenticação, consulta real, validação,
tratamento de erros e testes. Nenhuma chave de provedor é exposta à extensão ou ao navegador.
