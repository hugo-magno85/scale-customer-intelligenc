#!/usr/bin/env bash
# Cria o arquivo de configuração de um ambiente com senhas fortes geradas na hora.
#   init-env.sh <staging|production> <dominio-do-app> <dominio-da-api> <usuario-ou-org-do-github>
# Ex.: init-env.sh staging homolog-scale.academiascale.com.br api-homolog-scale.academiascale.com.br hugo-magno85
# Não sobrescreve um arquivo existente. As chaves de IA ficam em branco para você preencher depois.
set -euo pipefail
ENV_NAME="${1:?ambiente (staging|production)}"; APP="${2:?domínio do app}"; API="${3:?domínio da API}"; OWNER="${4:?dono do repositório no GitHub}"
DIR="$(cd "$(dirname "$0")/../compose" && pwd)"
FILE="$DIR/env/$ENV_NAME.env"
mkdir -p "$DIR/env"
if [[ -e "$FILE" ]]; then echo "já existe: $FILE (nada foi alterado)" >&2; exit 1; fi
pw() { openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40; }
umask 077
cat > "$FILE" <<CONF
# Gerado em $(date -u +%Y-%m-%dT%H:%M:%SZ) — NÃO versionar. Permissão 600.
SCI_ENV=$ENV_NAME
SCI_VERSION=
REGISTRY=ghcr.io/$OWNER
LOG_LEVEL=info

APP_DOMAIN=$APP
API_DOMAIN=$API
PUBLIC_APP_URL=https://$APP
COOKIE_DOMAIN=

SCI_DB_NAME=sci_$ENV_NAME
POSTGRES_SUPERUSER_PASSWORD=$(pw)
SCI_DB_OWNER_PASSWORD=$(pw)
SCI_DB_APP_PASSWORD=$(pw)
REDIS_PASSWORD=$(pw)

# Cofre de credenciais dos CRMs (guarde uma cópia segura desta chave: sem ela as credenciais não são recuperáveis)
SCI_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)
SCI_ENCRYPTION_ACTIVE_KEY=k1

# Portas locais (o painel do servidor encaminha os domínios para cá)
WEB_LOCAL_PORT=13000
API_LOCAL_PORT=14000

# Provedores de IA — preencha com: nano $FILE
DEEPGRAM_API_KEY=
DEEPGRAM_MODEL=nova-3
DEEPGRAM_LANGUAGE=pt-BR
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_FAST=
DEEPSEEK_MODEL_REASONING=
TYPESAFE_API_KEY=
TYPESAFE_DEFAULT_MODEL=
CONF
chmod 600 "$FILE"
echo "criado: $FILE"
echo "próximo passo: preencher as chaves de IA (opcional agora) e rodar deploy.sh $ENV_NAME <versão>"
