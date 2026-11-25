# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Etapa 2 — Skill de CS e Playbook Intelligence

- `@sci/cs-skill` v1.0.0: princípios, 8 indicadores com rubricas, 10 sinais de churn, 8 oportunidades, 12 tipos de pergunta, biblioteca de perguntas com aprofundamento, objetivos por tipo de reunião e regras de prudência; versionada com hash de conteúdo.
- Configuração da skill por tenant (tipos de pergunta, tom, cadência, prioridades, orientações).
- Extração de texto de PDF, DOCX, PPTX (com notas), XLSX, TXT e Markdown, com verificação de tipo pelo conteúdo e proteção contra zip bomb.
- Cliente DeepSeek (JSON mode, retry, correção guiada por validação) e cliente Jev/TypeSafe (`@typesafe-ai/sdk`) atrás de interfaces.
- Interpretação de playbooks em partes, normalização para contrato tipado, classificação do documento pelo Jev.
- Playbooks múltiplos por jornada, tipo de reunião, segmento e operação; versionamento, revisão, edição, aprovação, publicação, arquivamento, desativação e clone; versões aprovadas imutáveis no banco.
- Fila `sci.playbooks` (BullMQ) processada pelo worker; processamento inline em desenvolvimento.
- Telas: lista de playbooks, versões, editor estruturado com fluxo de aprovação e configuração da skill.

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
