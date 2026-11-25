# Implantação, backup e rollback

## Fluxo

1. PR → `develop` com CI verde → workflow `release.yml` publica imagens `dev-<sha>` → deploy em **homologação**.
2. Validação funcional em homologação.
3. PR `develop` → `main`, tag `vX.Y.Z` → imagens versionadas (environment `production` com aprovação manual no GitHub).
4. No servidor: `SCI_CONFIRM_PRODUCTION=yes infrastructure/scripts/deploy.sh production X.Y.Z`
   — só com autorização explícita da Academia Scale.

`deploy.sh` faz backup antes, atualiza `SCI_VERSION`, aplica migrations (serviço `migrate`) e só
conclui quando todos os health checks passam (`up --wait`).

## Rollback

`infrastructure/scripts/rollback.sh <ambiente>` volta para a versão anterior registrada.
Como as migrations seguem **expand/contract** (adicionar → migrar uso → remover em release posterior),
a versão anterior continua compatível com o banco. Em último caso: `restore.sh` restaura um backup em
um banco novo para validação antes da troca.

## Health checks

- API: `GET /health/live`, `GET /health/ready` (verifica banco)
- Worker: `GET :4100/health` (banco + Redis)
- Web: resposta HTTP do Next.js

## Retenção

- Backups: 30 dias locais (`RETENTION_DAYS`) + cópia externa.
- Sessões expiradas/revogadas: removidas diariamente pelo worker após 7 dias.
