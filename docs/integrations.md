# Integrações

| Serviço                                       | Papel                                                                                      | Etapa | Situação                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| DeepSeek                                      | Interpretação de playbooks, raciocínio, redação de perguntas e análises                    | 2     | Cliente a implementar; requer `DEEPSEEK_API_KEY`                                                                        |
| TypeSafe Jev (`@typesafe-ai/sdk`)             | Decisões tipadas: classificação de sinais, cobertura de checklist, prioridade, verificação | 2     | SDK avaliado (v0.7.0: perguntas `noul`, `choice`, `score` com probabilidades); requer `TYPESAFE_API_KEY` (early access) |
| Deepgram                                      | Transcrição em streaming pt-BR, multicanal                                                 | 3     | Requer `DEEPGRAM_API_KEY`                                                                                               |
| Bitrix24, Pipedrive, RD Station CRM, Zoho CRM | Contexto do cliente e publicação de resultados                                             | 7     | Por último, conforme definido                                                                                           |

Regra: uma integração só é considerada funcional após autenticação, consulta real, validação,
tratamento de erros e testes. Nenhuma chave de provedor é exposta à extensão ou ao navegador.

## CRM Integration Hub — fundação (implementada)

- `packages/crm-hub`: contrato `CrmClient` (validar conexão, consultar registro, publicar nota, criar tarefa),
  leitura de URL/ID por CRM, cliente HTTP com timeout, retry exponencial, `Retry-After`, limitador por conexão e chave de idempotência.
- Conexões por tenant (várias contas por CRM) com credencial **cifrada** (AES-256-GCM, AAD = tenant), nunca devolvida pela API nem registrada em log.
- **Vínculo manual** da reunião (web e extensão): selecionar CRM → URL ou ID → consultar → conferir → confirmar.
  Um vínculo ativo por reunião; troca exige `crm.link.change` e fica no histórico (quem, quando, origem manual/automática).
- `integration_syncs`: base para publicação idempotente com aprovação.

### Ainda não implementado (depende de contas e documentação oficial)

Nenhum CRM tem cliente de API registrado: todos aparecem como “Aguardando homologação”. Os padrões de URL
(`URL_PATTERNS_VERIFIED`) também precisam ser confirmados com contas reais. Até lá, o vínculo fica
“Aguardando validação no CRM” — sem dados inventados.
