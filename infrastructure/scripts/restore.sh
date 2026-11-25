#!/usr/bin/env bash
# Restaura um backup em um banco NOVO (nunca sobrescreve o banco em uso).
#   restore.sh <staging|production> <arquivo.dump> <nome_do_banco_destino>
set -euo pipefail
ENV_NAME="${1:?ambiente}"; FILE="${2:?arquivo .dump}"; TARGET="${3:?banco destino}"
sha256sum -c "$FILE.sha256"
docker compose -p "sci-$ENV_NAME" exec -T postgres createdb -U postgres -O sci_owner "$TARGET"
docker compose -p "sci-$ENV_NAME" exec -T postgres pg_restore -U postgres -d "$TARGET" --no-owner --role=sci_owner < "$FILE"
echo "restaurado em $TARGET. Valide e, se for o caso, aponte SCI_DB_NAME para ele."
