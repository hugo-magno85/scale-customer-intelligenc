#!/usr/bin/env bash
# Backup lógico do banco de um ambiente. Agendar via cron no servidor, ex.:
#   15 2 * * * /opt/academia-scale/scale-customer-intelligence/production/infrastructure/scripts/backup.sh production
set -euo pipefail
ENV_NAME="${1:?uso: backup.sh <staging|production>}"
BASE="${SCI_BASE:-/opt/academia-scale/scale-customer-intelligence}"
DEST="$BASE/backups/$ENV_NAME"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
mkdir -p "$DEST"
chmod 700 "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/sci-$ENV_NAME-$STAMP.dump"
# shellcheck disable=SC1090
source "$BASE/$ENV_NAME/infrastructure/compose/env/$ENV_NAME.env"
docker compose -p "sci-$ENV_NAME" exec -T postgres \
  pg_dump -U postgres -d "$SCI_DB_NAME" --format=custom --no-owner > "$FILE.partial"
mv "$FILE.partial" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
find "$DEST" -name "sci-$ENV_NAME-*.dump*" -mtime +"$RETENTION_DAYS" -delete
# Cópia fora do servidor: definir SCI_OFFSITE_CMD (ex.: rclone copy ... ) no ambiente do cron.
if [[ -n "${SCI_OFFSITE_CMD:-}" ]]; then eval "$SCI_OFFSITE_CMD \"$FILE\" \"$FILE.sha256\""; fi
echo "backup ok: $FILE"
