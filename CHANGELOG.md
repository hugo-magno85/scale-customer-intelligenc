# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Etapa 1 — Fundação

- Monorepo pnpm + Turborepo com TypeScript estrito.
- PostgreSQL 16 com Row Level Security **forçado**; papel `sci_app` sem BYPASSRLS; contexto por transação.
- Chaves estrangeiras compostas impedindo vínculos entre tenants.
- Autenticação por sessão (cookie httpOnly) e token revogável para a extensão; Argon2id; proteção CSRF por origem; rate limit de login.
- Multi-tenancy com superadmin (Academia Scale), papéis padrão (Administrador, Gestor, Customer Success, Analista) e permissões configuráveis por tenant.
- Trilha de auditoria imutável (somente inserção).
- Carteira de clientes e contatos; dashboard com indicadores apenas de dados reais.
- Criptografia de credenciais AES-256-GCM com rotação de chave.
- Worker BullMQ com job de retenção de sessões.
- Docker (API, worker, web), Compose para dev/homologação/produção, Caddy ou Nginx existente.
- Scripts de backup, restauração, deploy com aprovação para produção e rollback.
- GitHub Actions: lint, tipos, build, validação de migrations, testes, auditoria de dependências, gitleaks, CodeQL, publicação de imagens.
