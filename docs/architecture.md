# Arquitetura

Visão completa, justificativas e roadmap: [00-plano-fase-a.md](00-plano-fase-a.md).

## Módulos e contratos

| Módulo        | Pacote                             | Responsabilidade                                            | Contrato                             |
| ------------- | ---------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| Frontend SaaS | `apps/web`                         | 11 módulos de navegação                                     | `@sci/contracts` via REST            |
| Backend/API   | `apps/api`                         | Auth, RBAC, contexto de tenant, REST (WebSocket na Etapa 3) | OpenAPI gerado dos schemas Zod       |
| Worker        | `apps/worker`                      | Jobs assíncronos (BullMQ)                                   | Filas registradas em `src/queues.ts` |
| Banco         | `packages/db`                      | Migrations SQL, RLS, schema tipado                          | Migrations são a fonte da verdade    |
| Segurança     | `packages/security`                | Cifra de credenciais, senhas, tokens                        | API funcional pura                   |
| Contratos     | `packages/contracts`               | Tipos e validação compartilhados                            | Zod                                  |
| Skill de CS   | `packages/cs-skill` (Etapa 2)      | Conhecimento especialista versionado                        | Schemas Zod + evals                  |
| Inteligência  | `packages/intelligence` (Etapa 2+) | Motor de 5 camadas; DeepSeek + Jev                          | Entradas/saídas Zod                  |
| Extensão      | `apps/extension` (Etapa 3)         | Scale Assistant MV3                                         | `@sci/contracts`                     |
| CRM Hub       | `packages/crm-hub` (Etapa 7)       | Interface universal + provedores                            | `CrmProvider`                        |

## Fluxo de uma requisição

1. `onRequest`: resolve a sessão (cookie `sci_session` ou `Authorization: Bearer`) chamando a função
   `app.auth_session_user(hash)` — o token nunca é armazenado, só o SHA-256.
2. `onRequest`: requisições que alteram estado e usam cookie precisam de `Origin` permitida (CSRF).
3. `preHandler`: com `x-tenant-id`, confirma vínculo ativo do usuário e carrega as permissões do papel.
4. Rota: `requirePermission(...)` e acesso a dados via `tenantTx(req, fn)`, que abre transação e
   aplica `SET LOCAL app.tenant_id / app.user_id`. As políticas RLS filtram tudo o mais.
5. Alterações gravam auditoria **na mesma transação**.

## Camadas de defesa contra vazamento entre tenants

1. Verificação de vínculo no `preHandler` (403 para tenant alheio).
2. RLS forçado em todas as tabelas de tenant; o papel da aplicação não tem `BYPASSRLS` nem é dono.
3. Chaves estrangeiras compostas `(tenant_id, id)` — impossível referenciar registro de outro tenant.
4. Testes automatizados de isolamento no banco (`packages/db/test/rls.test.ts`) e na API (`apps/api/test/api.test.ts`).
