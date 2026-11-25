-- Executar UMA vez por cluster PostgreSQL, como superusuário:
--   psql -v owner_password="..." -v app_password="..." -v db_name=sci_production -f db-bootstrap.sql
-- Cria os papéis e o banco do Scale Customer Intelligence. Não toca em
-- nenhum outro banco ou papel existente no servidor.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE sci_owner LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sci_owner') \gexec

SELECT format('CREATE ROLE sci_app LOGIN PASSWORD %L NOBYPASSRLS', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sci_app') \gexec

ALTER ROLE sci_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE sci_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

SELECT format('CREATE DATABASE %I OWNER sci_owner', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO sci_app', :'db_name') \gexec
