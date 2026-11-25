# Instalação

## Desenvolvimento local

Ver [README](../README.md#começando-desenvolvimento).

## Servidor (homologação/produção)

> Nada aqui altera serviços existentes. Execute primeiro a inspeção somente leitura.

1. Inspecionar: `bash infrastructure/scripts/inspect-server.sh` e registrar o resultado.
2. Estrutura:
   ```
   /opt/academia-scale/scale-customer-intelligence/
     staging/      (checkout do repositório na branch develop)
     production/   (checkout do repositório na tag em produção)
     backups/{staging,production}/
   ```
3. Variáveis: copiar `.env.example` para `infrastructure/compose/env/<ambiente>.env` (permissão 600)
   com senhas geradas (`openssl rand -base64 32`), `SCI_ENV`, domínios e `SCI_VERSION`.
4. Proxy:
   - Sem proxy no servidor: `docker compose ... --profile caddy up -d` (TLS automático).
   - Com Nginx existente: usar `stack.localbind.yml` e criar **um novo** vhost a partir de
     `infrastructure/proxy/nginx-site.conf.example` (com autorização).
5. Subir: `infrastructure/scripts/deploy.sh staging <versão>`.
6. Criar o superadmin:
   ```
   docker compose -p sci-staging ... run --rm -e DATABASE_OWNER_URL=... -e SCI_ADMIN_PASSWORD=... \
     api node dist/cli/create-platform-admin.js --email ... --name "..."
   ```
7. Agendar backup diário (`backup.sh`) no cron e configurar `SCI_OFFSITE_CMD` para cópia externa.
8. Firewall: liberar apenas 22 (restrito), 80 e 443.
