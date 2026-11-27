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

## Bitrix24 — webhook de entrada (disponível)

Homologado com conta real em 27/11/2026: webhook, vínculo, comentário, tarefas e campos do negócio.

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

Status no produto: **Disponível** (lista `HOMOLOGATED` em `providers.ts` e `URL_PATTERNS_VERIFIED` em `references.ts`).

### Envio da análise ao card (Bitrix24)

Ao concluir a análise de uma reunião com registro vinculado, o worker envia ao Bitrix24 (`packages/jobs/src/crm-publisher.ts`):

1. **Comentário na timeline** (`crm.timeline.comment.add`):
   - resumo e diagnóstico;
   - Customer Health (0–10);
   - riscos com a evidência;
   - oportunidades e próximos passos;
   - link para a análise completa.
2. **Tarefas** (`tasks.task.add`): uma por ação **interna** do plano. As ações atribuídas ao cliente ficam de fora. Cada tarefa é vinculada ao negócio por `UF_CRM_TASK`, com prazo, e o responsável é o dono do negócio.
3. **Campos do negócio** (`crm.deal.update`), criados uma única vez com `crm.deal.userfield.add` se não existirem:
   - `UF_CRM_SCI_HEALTH`: Customer Health de 0 a 10;
   - `UF_CRM_SCI_RISK`: maior risco da reunião;
   - `UF_CRM_SCI_LAST_ANALYSIS`: data da análise.

   Criar campos exige a permissão do CRM "Permitir modificar configurações". Sem ela, o envio segue sem os campos e mostra um aviso.

**Controles**

- Por conexão, em Integrações:
  - "Enviar automaticamente ao card após a análise" (desligado por padrão);
  - escolha de quais partes enviar.
- Cada análise × registro gera um `integration_syncs`:
  - em nova tentativa, o comentário e as tarefas já criados não se repetem;
  - uma análise já enviada não é reenviada;
  - uma nova versão da análise (reanálise) gera um novo envio.
- Na reunião (Calls → reunião → Vincular registro do CRM) aparecem o status, o que foi gravado e os avisos, com o botão "Enviar análise ao CRM" ou "Reenviar o que falhou".
- O worker precisa de `SCI_ENCRYPTION_KEYS` (a mesma chave da API) e de `PUBLIC_APP_URL`. As duas já estão no `stack.yml`.

## Pipedrive — token de API (disponível)

Homologado com conta real em 27/11/2026: conexão, vínculo por URL, nota, atividade e campos do negócio.
Na tela de negócio do Pipedrive, os campos "(Scale)" precisam ser adicionados uma vez à seção Detalhes (Reordenar campos ▾).

Implementado em `packages/crm-hub/src/pipedrive.ts` a partir do cliente oficial
([pipedrive/client-nodejs](https://github.com/pipedrive/client-nodejs)), que é gerado da especificação OpenAPI.

- **Autenticação**: token de API pessoal no cabeçalho `x-api-token`.
  - O host é fixo (`api.pipedrive.com`), então o token nunca vai para outro endereço.
  - A conta é o subdomínio da empresa. `GET /v1/users/me` confere se `company_domain` é o mesmo da conexão.
- **Consulta**:
  - `GET /api/v2/deals/{id}`, `/organizations/{id}` e `/persons/{id}`;
  - `GET /v1/leads/{id}`, com ID em formato UUID;
  - `GET /v1/users/{id}` para o responsável.
- **Envio**:
  - nota: `POST /v1/notes`, em HTML escapado;
  - atividades do tipo `task`: `POST /api/v2/activities`, uma por ação interna, com prazo e dono;
  - campos do negócio: `GET/POST /api/v2/dealFields` para achar ou criar os campos pelo nome, e `PATCH /api/v2/deals/{id}` com `custom_fields`.

  Criar campos exige que o usuário do token seja administrador. Sem isso, a nota e as atividades seguem normalmente e a reunião mostra um aviso.

- **Erros e limites**:
  - 401 (token), 403 (permissão), 404 (registro) e 402 (plano) viram mensagens claras;
  - em 429 ou 5xx, espera e repete, respeitando `Retry-After`.
