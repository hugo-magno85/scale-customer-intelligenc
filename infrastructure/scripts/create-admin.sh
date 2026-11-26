#!/usr/bin/env bash
# Cria (ou promove) o superadmin da Academia Scale no ambiente. Pede a senha sem exibi-la.
#   create-admin.sh <staging|production> <email> "<Nome>"
set -euo pipefail
ENV_NAME="${1:?ambiente}"; EMAIL="${2:?e-mail}"; NAME="${3:?nome}"
DIR="$(cd "$(dirname "$0")/../compose" && pwd)"
ENV_FILE="$DIR/env/$ENV_NAME.env"
# shellcheck disable=SC1090
source "$ENV_FILE"
read -r -s -p "Senha do superadmin (mín. 12 caracteres): " PW; echo
docker compose -p "sci-$ENV_NAME" --env-file "$ENV_FILE" -f "$DIR/stack.yml" run --rm \
  -e DATABASE_OWNER_URL="postgres://sci_owner:${SCI_DB_OWNER_PASSWORD}@postgres:5432/${SCI_DB_NAME}" \
  -e SCI_ADMIN_PASSWORD="$PW" \
  api node dist/cli/create-platform-admin.js --email "$EMAIL" --name "$NAME"
