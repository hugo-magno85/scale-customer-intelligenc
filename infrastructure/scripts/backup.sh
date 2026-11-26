#!/usr/bin/env bash
# Backup lógico do banco de um ambiente. Agendar via cron no servidor, ex.:
#   15 2 * * * /opt/academia-scale/scale-customer-intelligence/staging/infrastructure/scripts/backup.sh staging
set -euo pipefail
ENV_NAME="${1:?uso: backup.sh <staging|production>}"
DIR="$(cd "$(dirname "$0")/../compose" && pwd)"
ENV_FILE="$DIR/env/$ENV_NAME.env"
BASE="${SCI_BASE:-/opt/academia-scale/scale-customer-intelligence}"
DEST="$BASE/backups/$ENV_NAME"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE=(docker compose -p "sci-$ENV_NAME" --env-file "$ENV_FILE" -f "$DIR/stack.yml")
# shellcheck disable=SC1090
source "$ENV_FILE"
if ! "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "banco do ambiente $ENV_NAME ainda não está rodando: nada a copiar"
  exit 0
fi
mkdir -p "$DEST" && chmod 700 "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/sci-$ENV_NAME-$STAMP.dump"
"${COMPOSE[@]}" exec -T postgres pg_dump -U postgres -d "$SCI_DB_NAME" --format=custom --no-owner > "$FILE.partial"
mv "$FILE.partial" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
find "$DEST" -name "sci-$ENV_NAME-*.dump*" -mtime +"$RETENTION_DAYS" -delete
# Cópia fora do servidor: definir SCI_OFFSITE_CMD (ex.: rclone copy ...) no ambiente do cron.
if [[ -n "${SCI_OFFSITE_CMD:-}" ]]; then eval "$SCI_OFFSITE_CMD \"$FILE\" \"$FILE.sha256\""; fi
echo "backup ok: $FILE"
