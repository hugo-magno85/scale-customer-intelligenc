-- =====================================================================
-- 0006 — Customer Intelligence: análises, indicadores, Health, Churn Radar,
-- Expansão e Planos de Ação. Toda classificação guarda evidências.
-- =====================================================================

CREATE TABLE tenant_health_settings (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meeting_analyses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  meeting_id           uuid NOT NULL,
  version              integer NOT NULL CHECK (version > 0),
  status               text NOT NULL CHECK (status IN ('processing','completed','failed')),
  mode                 text CHECK (mode IN ('full','basic')),
  summary              text,
  diagnosis            text,
  result               jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings             text[] NOT NULL DEFAULT '{}',
  error                text,
  model                text,
  skill_version        text REFERENCES cs_skill_versions(version),
  playbook_version_id  uuid,
  requested_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (meeting_id, version),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, playbook_version_id) REFERENCES playbook_versions (tenant_id, id)
);

CREATE TABLE intelligence_indicators (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  analysis_id  uuid NOT NULL,
  meeting_id   uuid NOT NULL,
  customer_id  uuid,
  indicator    text NOT NULL CHECK (indicator IN ('satisfaction','trust','engagement','value_perception','adoption','expectation_alignment','churn_risk','expansion_opportunity')),
  score        real CHECK (score BETWEEN 0 AND 100),
  confidence   real CHECK (confidence BETWEEN 0 AND 1),
  rationale    text NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, indicator),
  FOREIGN KEY (tenant_id, analysis_id) REFERENCES meeting_analyses (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE,
  -- explicabilidade: nota só existe com evidência
  CHECK (score IS NULL OR jsonb_array_length(evidence) > 0)
);
CREATE INDEX indicators_customer_idx ON intelligence_indicators (tenant_id, customer_id, indicator, created_at);

CREATE TABLE customer_health_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  customer_id     uuid NOT NULL,
  meeting_id      uuid,
  analysis_id     uuid,
  score           real CHECK (score BETWEEN 0 AND 100),
  classification  text CHECK (classification IN ('healthy','attention','high_risk')),
  factors         jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing         text[] NOT NULL DEFAULT '{}',
  overrides       text[] NOT NULL DEFAULT '{}',
  weights         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, analysis_id) REFERENCES meeting_analyses (tenant_id, id) ON DELETE SET NULL (analysis_id),
  CHECK ((score IS NULL) = (classification IS NULL))
);
CREATE INDEX health_customer_idx ON customer_health_snapshots (tenant_id, customer_id, created_at DESC);

CREATE TABLE churn_signals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  customer_id            uuid NOT NULL,
  factor_key             text NOT NULL,
  factor_label           text NOT NULL,
  severity               text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  recurrence             integer NOT NULL DEFAULT 1 CHECK (recurrence >= 1),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','resolved')),
  evidence               jsonb NOT NULL,
  recommendation         text NOT NULL,
  next_action            text,
  revenue_at_risk_cents  bigint CHECK (revenue_at_risk_cents IS NULL OR revenue_at_risk_cents >= 0),
  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  last_meeting_id        uuid,
  last_analysis_id       uuid,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE,
  CHECK (jsonb_array_length(evidence) > 0)
);
CREATE UNIQUE INDEX churn_open_factor ON churn_signals (customer_id, factor_key) WHERE status <> 'resolved';
CREATE INDEX churn_tenant_idx ON churn_signals (tenant_id, status, severity);

CREATE TABLE expansion_opportunities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  customer_id      uuid NOT NULL,
  meeting_id       uuid,
  analysis_id      uuid,
  type             text NOT NULL,
  type_label       text NOT NULL,
  need             text NOT NULL,
  evidence         jsonb NOT NULL,
  potential_cents  bigint CHECK (potential_cents IS NULL OR potential_cents >= 0),
  product          text,
  next_action      text,
  owner_user_id    uuid,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','qualified','won','lost','discarded')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES tenant_memberships (tenant_id, user_id),
  CHECK (jsonb_array_length(evidence) > 0)
);
CREATE TRIGGER expansion_touch BEFORE UPDATE ON expansion_opportunities FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE action_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  customer_id  uuid,
  meeting_id   uuid,
  analysis_id  uuid,
  title        text NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE action_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  plan_id            uuid,
  customer_id        uuid,
  meeting_id         uuid,
  title              text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  description        text,
  owner_user_id      uuid,
  responsible_party  text NOT NULL DEFAULT 'internal' CHECK (responsible_party IN ('internal','customer')),
  due_date           date,
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
  evidence           jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation     text,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES action_plans (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES tenant_memberships (tenant_id, user_id)
);
CREATE INDEX tasks_tenant_status_idx ON action_tasks (tenant_id, status, due_date);
CREATE TRIGGER tasks_touch BEFORE UPDATE ON action_tasks FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- RLS ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_health_settings','meeting_analyses','intelligence_indicators','customer_health_snapshots',
                           'churn_signals','expansion_opportunities','action_plans','action_tasks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sci_app', t);
  END LOOP;
END $$;
GRANT DELETE ON intelligence_indicators TO sci_app;
