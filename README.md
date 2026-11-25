# Scale Customer Intelligence

> Transforme cada conversa em inteligência para proteger a receita.

Plataforma SaaS multi-tenant da **Academia Scale** que atua como um especialista virtual em
Customer Success durante reuniões com clientes: sugere perguntas no momento certo, identifica
riscos e oportunidades e transforma a conversa em inteligência estruturada — com publicação no CRM.

Componentes: plataforma web, API, worker e a extensão Chrome **Scale Assistant** (a partir da Etapa 3).

## Status

| Etapa | Escopo                                                                                      | Situação                             |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1     | Fundação: monorepo, banco com RLS, autenticação, multi-tenancy, RBAC, auditoria, CI, Docker | ✅ implementada e testada localmente |
| 2     | Skill de CS + Playbook Intelligence                                                         | em andamento                         |
| 3     | Scale Assistant (extensão MV3) + Deepgram                                                   | —                                    |
| 4     | Inteligência em tempo real                                                                  | —                                    |
| 5     | Customer Intelligence (Health, Churn, Expansão, Planos de Ação)                             | —                                    |
| 6     | Dashboard e relatórios                                                                      | —                                    |
| 7     | CRM Integration Hub (Bitrix24, Pipedrive, RD Station CRM, Zoho CRM)                         | —                                    |

Detalhes no [plano da Fase A](docs/00-plano-fase-a.md) e no [CHANGELOG](CHANGELOG.md).

## Estrutura

```
apps/api         API REST (Fastify + Zod), autenticação, RBAC, contexto de tenant
apps/web         Plataforma web (Next.js)
apps/worker      Jobs assíncronos (BullMQ + Redis)
apps/extension   Scale Assistant — extensão Chrome MV3
packages/contracts  Contratos Zod compartilhados (API, web, extensão)
packages/db      Migrations SQL, políticas RLS, schema Drizzle, migrator
packages/security   Criptografia de credenciais (AES-256-GCM), senhas (Argon2id), tokens
infrastructure   Dockerfiles, Compose, proxy, scripts de backup/deploy/rollback
docs             Arquitetura, ADRs, instalação, deploy, segurança/LGPD
```

## Começando (desenvolvimento)

Pré-requisitos: Node 22.15+, pnpm 10, Docker.

```bash
pnpm install
docker compose -f infrastructure/compose/dev.yml up -d
cp .env.example .env   # ajuste se necessário
export $(grep -v '^#' .env | xargs)
pnpm db:migrate
SCI_ADMIN_PASSWORD='uma-senha-forte-aqui' pnpm --filter @sci/api create-platform-admin -- --email voce@academiascale.com.br --name "Seu Nome"
pnpm dev
```

Web em http://localhost:3000 · API em http://localhost:4000 · OpenAPI em `/v1/openapi.json` (fora de produção).

## Testes

```bash
export TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

Os testes de banco rodam contra PostgreSQL real, cada suíte em um banco descartável, e
incluem a verificação de isolamento entre tenants.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Segurança, multi-tenancy e LGPD](docs/security.md)
- [Instalação](docs/installation.md)
- [Implantação, backup e rollback](docs/deployment.md)
- [Skill de CS e Playbook Intelligence](docs/playbook-intelligence.md)
- [Scale Assistant (extensão)](docs/scale-assistant.md)
- [Integrações](docs/integrations.md)
- [Decisões técnicas (ADRs)](docs/adr)
- [Como contribuir](CONTRIBUTING.md)
