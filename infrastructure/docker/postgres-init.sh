#!/bin/sh
# Executado pela imagem oficial do Postgres na primeira inicialização do volume.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$SCI_DB_OWNER_PASSWORD" \
  -v app_password="$SCI_DB_APP_PASSWORD" \
  -v db_name="$SCI_DB_NAME" \
  -f /bootstrap/db-bootstrap.sql
