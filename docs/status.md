# Status do projeto e próximos passos

Atualizado em 2026-11-25.

## Entregue (branch `develop`)

| Etapa                            | Situação             | Validação                                                                                   |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| 1. Fundação                      | ✅                   | Testes (RLS/isolamento, API), stack Docker completa subida localmente, E2E no navegador     |
| 2. Skill de CS + Playbooks       | ✅                   | Testes; fluxo upload → fila → worker validado em containers                                 |
| 3. Scale Assistant + transcrição | ✅                   | Testes; extensão real no Chromium; relay com cliente Deepgram real contra servidor simulado |
| 4. Inteligência em tempo real    | ✅                   | Testes do motor + API + painel no navegador                                                 |
| 5. Customer Intelligence         | ✅                   | Testes ponta a ponta; cliente DeepSeek real contra servidor simulado; telas                 |
| 6. Dashboard e relatórios        | ✅                   | Testes; telas desktop e celular; exportação CSV                                             |
| 7. CRM Integration Hub           | ⏸ aguardando insumos | —                                                                                           |

157 testes automatizados passando; lint, tipos, build, formatação e auditoria de dependências sem pendências.

## O que depende da Academia Scale

1. **GitHub**: criar o repositório vazio `scale-customer-intelligence` e dar acesso de escrita a esta sessão
   (ou reconectar o GitHub nas configurações de conectores). O código está pronto para `git push` de `main` e `develop`.
2. **Servidor**: acesso SSH ao servidor escolhido. Primeiro passo será `infrastructure/scripts/inspect-server.sh` (somente leitura).
3. **Chaves** (ficam só no servidor): `DEEPSEEK_API_KEY`, `TYPESAFE_API_KEY` (early access do Jev), `DEEPGRAM_API_KEY`.
   Confirmar os IDs de modelo vigentes do DeepSeek (`DEEPSEEK_MODEL_FAST`, `DEEPSEEK_MODEL_REASONING`).
4. **Decisão LGPD sobre o DeepSeek** (API oficial com DPA e aviso, ou modelos abertos em outro provedor).
5. **Domínios** de homologação e produção.
6. **Etapa 7 — CRMs**: contas de teste (sandbox) e apps OAuth de Pipedrive, Zoho CRM, Bitrix24 e RD Station CRM,
   além de acesso à documentação oficial (os sites de documentação não são acessíveis deste ambiente).

## Calibrações pendentes (exigem chaves e reuniões reais)

- Limiares de sinais do Jev (0,6) e de conferência de evidências (0,5).
- Qualidade da transcrição pt-BR no Deepgram com reuniões reais da Academia Scale.
- Interpretação de playbooks reais e revisão da biblioteca de perguntas da skill.
- Captura de áudio em reuniões reais no Meet, Zoom web e Teams web (exige clique humano no ícone da extensão).

## Etapa 7 — plano

Interface universal `CrmProvider` (buscar por URL/ID/nome, ler empresa/negócio/contato/responsável, publicar nota,
tarefas e campos), tokens cifrados por tenant (`@sci/security`, AAD = tenant), renovação de OAuth, múltiplas contas,
`integration_syncs` com idempotência, retry e rate limit, vínculo manual na extensão (campo “Vincular registro do CRM”)
com histórico e permissão `crm.link.change`, publicação com aprovação configurável. Cada CRM só será marcado como
pronto após autenticação, consulta real, validação, tratamento de erros e testes.
