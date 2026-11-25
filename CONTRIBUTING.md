# Como contribuir

## Branches

- `main` — produção. Protegida; só recebe merge de `release/*` ou `hotfix/*` via PR.
- `develop` — integração/homologação. Protegida; recebe PRs de `feature/*` e `fix/*`.
- `feature/<etapa>-<assunto>` (ex.: `feature/e2-playbook-upload`), `fix/<assunto>`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/pt-br/): `feat(api): ...`, `fix(db): ...`, `docs: ...`, `chore(ci): ...`.

## Pull Requests

- CI verde é obrigatório (lint, tipos, build, migrations, testes, segurança).
- Preencha o template; descreva como foi testado.
- Releases: tag `vX.Y.Z` em `main` + entrada no CHANGELOG.

## Regras do projeto

1. Nenhum segredo, token ou dado real de cliente no repositório.
2. Toda tabela com dados de tenant tem `tenant_id`, RLS habilitado **e forçado**, e teste de isolamento.
3. Acesso a dados de tenant somente via `database.withContext(...)` / `tenantTx(req, ...)`.
4. Migrations são imutáveis depois de aplicadas e seguem expand/contract.
5. Contratos de entrada e saída sempre em `packages/contracts` (Zod).
6. Indicadores sem dados reais retornam `null` — nunca números estimados ou fictícios.
7. Uma funcionalidade só é "concluída" com testes e validação funcional.
