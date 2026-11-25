#!/usr/bin/env bash
# Deploy de uma versão já publicada no registry.
#   deploy.sh <staging|production> <versão>   (ex.: deploy.sh staging 0.1.0)
# Produção exige SCI_CONFIRM_PRODUCTION=yes (aprovação explícita).
set -euo pipefail
ENV_NAME="${1:?ambiente}"; VERSION="${2:?versão}"
if [[ "$ENV_NAME" == "production" && "${SCI_CONFIRM_PRODUCTION:-}" != "yes" ]]; then
  echo "deploy em produção exige SCI_CONFIRM_PRODUCTION=yes" >&2; exit 1
fi
DIR="$(cd "$(dirname "$0")/../compose" && pwd)"
ENV_FILE="$DIR/env/$ENV_NAME.env"
PREV="$(grep -E '^SCI_VERSION=' "$ENV_FILE" | cut -d= -f2 || true)"
"$(dirname "$0")/backup.sh" "$ENV_NAME"
sed -i "s/^SCI_VERSION=.*/SCI_VERSION=$VERSION/" "$ENV_FILE"
echo "$PREV" > "$DIR/env/$ENV_NAME.previous-version"
cd "$DIR"
docker compose -p "sci-$ENV_NAME" --env-file "$ENV_FILE" -f stack.yml pull
docker compose -p "sci-$ENV_NAME" --env-file "$ENV_FILE" -f stack.yml up -d --wait
echo "deploy $ENV_NAME $VERSION concluído (anterior: ${PREV:-nenhuma})"
