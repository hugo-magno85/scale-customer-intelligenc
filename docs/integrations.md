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

## Bitrix24 — webhook de entrada (em homologação)

Implementado em `packages/crm-hub/src/bitrix24.ts`, com base na documentação oficial da REST API
([bitrix24/b24restdocs](https://github.com/bitrix24/b24restdocs)).

- **Autenticação**: webhook de entrada de um portal Bitrix24 em nuvem.
  - Formato: `https://PORTAL.bitrix24.<tld>/rest/<id_usuario>/<código>/`.
  - A URL é validada antes de gravar e antes de cada uso: precisa ser https, de um domínio `*.bitrix24.*` e do mesmo portal da conexão. Isso impede que a API seja usada para chamar outros endereços.
  - Fica guardada cifrada e nunca é devolvida nem registrada em log.
- **Validação**: método `scope`; exige a permissão `crm`.
- **Consulta** (vínculo manual da reunião):
  - `crm.deal.get`, `crm.company.get`, `crm.contact.get` e `crm.lead.get`;
  - `user.get` traz o nome do responsável. Sem a permissão `user`, mostra só o ID.
- **Escrita**: `crm.timeline.comment.add` (comentário no card) e `tasks.task.add` (tarefa vinculada via `UF_CRM_TASK`).
  Só é usada pelo fluxo de publicação com aprovação; nada é gravado no CRM automaticamente.
- **Limites**: até 2 requisições por segundo por portal, no balde de 50 do plano padrão. Em `QUERY_LIMIT_EXCEEDED` ou 5xx, espera e repete, respeitando `Retry-After`. Em `OPERATION_TIME_LIMIT` (bloqueio de 5 minutos), não repete.
- **Erros** traduzidos:
  - webhook inválido ou desativado;
  - falta de permissão no webhook;
  - REST fora do plano;
  - registro não encontrado;
  - usuário sem acesso ao registro.
- **Ainda não suportado**: Bitrix24 instalado no próprio servidor (on-premise) e OAuth/Marketplace.

Status no produto: **Em homologação**. Passa a **Disponível** depois da consulta real validada com a conta da
Academia Scale (lista `HOMOLOGATED` em `providers.ts` e `URL_PATTERNS_VERIFIED` em `references.ts`).
