#!/usr/bin/env bash
# Volta para a versão anterior. As migrations seguem o padrão expand/contract,
# então a versão anterior continua compatível com o banco atual.
set -euo pipefail
ENV_NAME="${1:?ambiente}"
DIR="$(cd "$(dirname "$0")/../compose" && pwd)"
PREV="$(cat "$DIR/env/$ENV_NAME.previous-version")"
[[ -n "$PREV" ]] || { echo "sem versão anterior registrada" >&2; exit 1; }
SCI_CONFIRM_PRODUCTION="${SCI_CONFIRM_PRODUCTION:-}" "$(dirname "$0")/deploy.sh" "$ENV_NAME" "$PREV"
