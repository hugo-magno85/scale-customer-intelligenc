#!/usr/bin/env bash
# Deploy de uma versão já publicada no registry (imagens geradas pelo GitHub Actions).
#   deploy.sh <staging|production> <versão>   (ex.: deploy.sh staging dev-6b8b78e)
# Produção exige SCI_CONFIRM_PRODUCTION=yes (aprovação explícita).
# Com SCI_LOCALBIND=1 (padrão), web e API ficam só em 127.0.0.1 para o proxy do servidor encaminhar.
set -euo pipefail
ENV_NAME="${1:?ambiente}"; VERSION="${2:?versão}"
if [[ "$ENV_NAME" == "production" && "${SCI_CONFIRM_PRODUCTION:-}" != "yes" ]]; then
  echo "deploy em produção exige SCI_CONFIRM_PRODUCTION=yes" >&2; exit 1
fi
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
DIR="$(cd "$SCRIPTS/../compose" && pwd)"
ENV_FILE="$DIR/env/$ENV_NAME.env"
[[ -f "$ENV_FILE" ]] || { echo "falta $ENV_FILE — rode init-env.sh primeiro" >&2; exit 1; }
# Ignora variáveis já exportadas no terminal com os mesmos nomes do arquivo de configuração:
# no Compose, o ambiente do shell tem prioridade sobre --env-file e mascararia a versão nova.
while IFS='=' read -r _k _; do [[ "$_k" =~ ^[A-Z_][A-Z0-9_]*$ ]] && unset "$_k"; done < "$ENV_FILE"
FILES=(-f "$DIR/stack.yml")
[[ "${SCI_LOCALBIND:-1}" == "1" ]] && FILES+=(-f "$DIR/stack.localbind.yml")
COMPOSE=(docker compose -p "sci-$ENV_NAME" --env-file "$ENV_FILE" "${FILES[@]}")
PREV="$(grep -E '^SCI_VERSION=' "$ENV_FILE" | cut -d= -f2 || true)"
"$SCRIPTS/backup.sh" "$ENV_NAME"
sed -i "s/^SCI_VERSION=.*/SCI_VERSION=$VERSION/" "$ENV_FILE"
echo "$PREV" > "$DIR/env/$ENV_NAME.previous-version"
[[ "${SCI_SKIP_PULL:-0}" == "1" ]] || "${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --wait
echo "deploy $ENV_NAME $VERSION concluído (anterior: ${PREV:-nenhuma})"
