-- =====================================================================
-- 0001 — Fundação: tenants, identidade, RBAC, carteira e auditoria
--
-- Modelo de segurança:
--   * sci_owner  : dono do schema, usado SOMENTE por migrations.
--   * sci_app    : papel da aplicação. Não é dono das tabelas e não tem
--                  BYPASSRLS, portanto toda leitura/escrita passa por RLS.
--   * Contexto por transação (SET LOCAL via set_config(..., true)):
--       app.tenant_id, app.user_id, app.platform_admin
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sci_app') THEN
    CREATE ROLE sci_app NOLOGIN;
  END IF;
END$$;

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO sci_app;

-- Funções de contexto --------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Tenants --------------------------------------------------------------
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_touch BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Usuários (identidade global; um usuário pode pertencer a vários tenants)
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  name               text NOT NULL,
  password_hash      text NOT NULL,
  is_platform_admin  boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Sessões (web e extensão). Só o hash do token é armazenado.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('web', 'extension')),
  user_agent    text,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Papéis por tenant (permissões configuráveis) -------------------------
CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  system_key   text CHECK (system_key IN ('tenant_admin', 'manager', 'cs', 'analyst')),
  permissions  text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX roles_system_key ON roles (tenant_id, system_key) WHERE system_key IS NOT NULL;
CREATE TRIGGER roles_touch BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE tenant_memberships (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  -- o papel precisa ser do MESMO tenant
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles (tenant_id, id)
);
CREATE INDEX memberships_user_idx ON tenant_memberships (user_id);
CREATE TRIGGER memberships_touch BEFORE UPDATE ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Carteira -------------------------------------------------------------
CREATE TABLE customers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  segment                  text,
  owner_user_id            uuid,
  relationship_started_at  date,
  mrr_cents                bigint CHECK (mrr_cents IS NULL OR mrr_cents >= 0),
  mrr_source               text CHECK (mrr_source IN ('manual', 'crm')),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'churned', 'paused')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- responsável precisa ser membro do mesmo tenant
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES tenant_memberships (tenant_id, user_id),
  CHECK ((mrr_cents IS NULL) = (mrr_source IS NULL))
);
CREATE INDEX customers_tenant_name_idx ON customers (tenant_id, lower(name));
CREATE INDEX customers_tenant_owner_idx ON customers (tenant_id, owner_user_id);
CREATE TRIGGER customers_touch BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL,
  name         text NOT NULL,
  email        text,
  phone        text,
  job_title    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX contacts_customer_idx ON contacts (tenant_id, customer_id);
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Auditoria (somente inserção) -----------------------------------------
CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_created_idx ON audit_logs (tenant_id, created_at DESC);

-- =====================================================================
-- Row Level Security
-- =====================================================================
ALTER TABLE tenants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants             FORCE  ROW LEVEL SECURITY;
ALTER TABLE roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles               FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships  FORCE  ROW LEVEL SECURITY;
ALTER TABLE customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers           FORCE  ROW LEVEL SECURITY;
ALTER TABLE contacts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts            FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs          FORCE  ROW LEVEL SECURITY;
-- users e sessions: RLS habilitado (vale para sci_app), mas não forçado,
-- para que as funções SECURITY DEFINER de autenticação (dono sci_owner)
-- consigam localizar usuário por e-mail e sessão por hash de token.
ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions  ENABLE ROW LEVEL SECURITY;

-- tenants: visível no tenant atual, para membros, ou para superadmin
CREATE POLICY tenants_select ON tenants FOR SELECT USING (
  id = app.current_tenant()
  OR app.is_platform_admin()
  OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = tenants.id AND m.user_id = app.current_user_id())
);
CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (app.is_platform_admin());
CREATE POLICY tenants_update ON tenants FOR UPDATE
  USING (id = app.current_tenant() OR app.is_platform_admin())
  WITH CHECK (id = app.current_tenant() OR app.is_platform_admin());

-- users: o próprio usuário, membros do tenant atual, ou superadmin
CREATE POLICY users_select ON users FOR SELECT USING (
  id = app.current_user_id()
  OR app.is_platform_admin()
  OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = users.id AND m.tenant_id = app.current_tenant())
);
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (
  (app.current_tenant() IS NOT NULL OR app.is_platform_admin()) AND is_platform_admin = false
);
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = app.current_user_id() OR app.is_platform_admin())
  WITH CHECK (id = app.current_user_id() OR app.is_platform_admin());

-- sessions: só as do próprio usuário
CREATE POLICY sessions_all ON sessions FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

-- roles: tenant atual; leitura também para tenants dos quais o usuário é membro
CREATE POLICY roles_select ON roles FOR SELECT USING (
  tenant_id = app.current_tenant()
  OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = roles.tenant_id AND m.user_id = app.current_user_id())
);
CREATE POLICY roles_write ON roles FOR INSERT WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY roles_update ON roles FOR UPDATE USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY roles_delete ON roles FOR DELETE USING (tenant_id = app.current_tenant());

-- memberships: leitura no tenant atual ou das próprias; escrita só no tenant atual
CREATE POLICY memberships_select ON tenant_memberships FOR SELECT
  USING (tenant_id = app.current_tenant() OR user_id = app.current_user_id());
CREATE POLICY memberships_insert ON tenant_memberships FOR INSERT WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY memberships_update ON tenant_memberships FOR UPDATE
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY memberships_delete ON tenant_memberships FOR DELETE USING (tenant_id = app.current_tenant());

-- tabelas de negócio: estritamente o tenant atual
CREATE POLICY customers_tenant ON customers FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY contacts_tenant ON contacts FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

-- auditoria: leitura do tenant atual (ou plataforma para superadmin); inserção controlada
CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (tenant_id = app.current_tenant() OR (tenant_id IS NULL AND app.is_platform_admin()));
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant() OR (tenant_id IS NULL AND app.current_user_id() IS NOT NULL) OR app.is_platform_admin());

-- =====================================================================
-- Funções de autenticação (SECURITY DEFINER, superfície mínima)
-- =====================================================================
CREATE OR REPLACE FUNCTION app.auth_find_user_by_email(p_email text)
RETURNS TABLE (id uuid, password_hash text, status text, is_platform_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash, u.status, u.is_platform_admin FROM users u WHERE u.email = lower(p_email)
$$;

CREATE OR REPLACE FUNCTION app.auth_session_user(p_token_hash text)
RETURNS TABLE (session_id uuid, user_id uuid, kind text, is_platform_admin boolean, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.user_id, s.kind, u.is_platform_admin, s.expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.status = 'active'
$$;

REVOKE ALL ON FUNCTION app.auth_find_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_session_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_find_user_by_email(text) TO sci_app;
GRANT EXECUTE ON FUNCTION app.auth_session_user(text) TO sci_app;
GRANT EXECUTE ON FUNCTION app.current_tenant(), app.current_user_id(), app.is_platform_admin() TO sci_app;

-- =====================================================================
-- Privilégios do papel da aplicação
-- =====================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, users, sessions, roles, tenant_memberships, customers, contacts TO sci_app;
GRANT SELECT, INSERT ON audit_logs TO sci_app;  -- sem UPDATE/DELETE: trilha imutável
