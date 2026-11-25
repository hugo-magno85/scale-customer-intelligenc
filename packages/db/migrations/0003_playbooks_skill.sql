-- =====================================================================
-- 0003 — Playbook Intelligence e Skill de CS
-- =====================================================================

-- Versões da skill de CS (catálogo global, sem dados de tenant) ----------
CREATE TABLE cs_skill_versions (
  version       text PRIMARY KEY CHECK (version ~ '^\d+\.\d+\.\d+$'),
  content_hash  text NOT NULL,
  released_at   date NOT NULL,
  changelog     text[] NOT NULL DEFAULT '{}',
  registered_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON cs_skill_versions TO sci_app;
-- catálogo global: leitura livre, inserção idempotente pela aplicação ao iniciar.
ALTER TABLE cs_skill_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY skill_versions_read ON cs_skill_versions FOR SELECT USING (true);
CREATE POLICY skill_versions_insert ON cs_skill_versions FOR INSERT WITH CHECK (true);

-- Configuração da skill por tenant ---------------------------------------
CREATE TABLE tenant_skill_settings (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Playbooks ----------------------------------------------------------------
CREATE TABLE playbooks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  description    text,
  meeting_type   text NOT NULL CHECK (meeting_type IN ('onboarding','follow_up','results_review','satisfaction','at_risk_recovery','retention','expansion','executive_review','other')),
  journey_stage  text,
  segment        text,
  operation      text,
  active         boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER playbooks_touch BEFORE UPDATE ON playbooks FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE playbook_versions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  playbook_id            uuid NOT NULL,
  number                 integer NOT NULL CHECK (number > 0),
  status                 text NOT NULL CHECK (status IN ('processing','failed','draft','in_review','approved','published','archived')),
  source                 text NOT NULL CHECK (source IN ('upload','manual')),
  structure              jsonb,
  processing_error       text,
  processing_warnings    text[] NOT NULL DEFAULT '{}',
  interpretation_model   text,
  interpretation_usage   jsonb,
  skill_version          text REFERENCES cs_skill_versions(version),
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at            timestamptz,
  published_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (playbook_id, number),
  FOREIGN KEY (tenant_id, playbook_id) REFERENCES playbooks (tenant_id, id) ON DELETE CASCADE,
  CHECK (status NOT IN ('approved','published') OR (structure IS NOT NULL AND approved_by IS NOT NULL))
);
-- No máximo UMA versão publicada por playbook.
CREATE UNIQUE INDEX playbook_versions_one_published ON playbook_versions (playbook_id) WHERE status = 'published';
CREATE INDEX playbook_versions_tenant_idx ON playbook_versions (tenant_id, playbook_id);
CREATE TRIGGER playbook_versions_touch BEFORE UPDATE ON playbook_versions FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Versões aprovadas/publicadas/arquivadas são imutáveis (análises referenciam a versão usada).
CREATE OR REPLACE FUNCTION app.playbook_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved','published','archived') AND NEW.structure IS DISTINCT FROM OLD.structure THEN
    RAISE EXCEPTION 'versão % do playbook não pode ser editada (status %)', OLD.number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER playbook_versions_immutable BEFORE UPDATE ON playbook_versions
  FOR EACH ROW EXECUTE FUNCTION app.playbook_version_immutable();

-- Documentos enviados (conteúdo armazenado no banco nesta fase; ver ADR 0005)
CREATE TABLE playbook_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  version_id         uuid NOT NULL,
  filename           text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  mime_type          text NOT NULL,
  size_bytes         integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  sha256             text NOT NULL,
  content            bytea NOT NULL,
  extracted_text     text,
  extracted_chars    integer,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES playbook_versions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX playbook_documents_version_idx ON playbook_documents (tenant_id, version_id);

-- Perguntas normalizadas da versão publicada: identificador estável para
-- sugestões em tempo real referenciarem a pergunta do playbook.
CREATE TABLE playbook_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  version_id   uuid NOT NULL,
  key          text NOT NULL,
  text         text NOT NULL,
  type         text NOT NULL,
  indicator    text,
  priority     text NOT NULL,
  stage_key    text,
  weight       numeric(4,2) NOT NULL,
  required     boolean NOT NULL,
  position     integer NOT NULL,
  UNIQUE (version_id, key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES playbook_versions (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE playbook_criteria (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  version_id   uuid NOT NULL,
  key          text NOT NULL,
  name         text NOT NULL,
  description  text NOT NULL,
  indicator    text,
  weight       numeric(4,2) NOT NULL,
  UNIQUE (version_id, key),
  FOREIGN KEY (tenant_id, version_id) REFERENCES playbook_versions (tenant_id, id) ON DELETE CASCADE
);

-- RLS -------------------------------------------------------------------
ALTER TABLE tenant_skill_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_skill_settings FORCE  ROW LEVEL SECURITY;
ALTER TABLE playbooks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbooks             FORCE  ROW LEVEL SECURITY;
ALTER TABLE playbook_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_versions     FORCE  ROW LEVEL SECURITY;
ALTER TABLE playbook_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_documents    FORCE  ROW LEVEL SECURITY;
ALTER TABLE playbook_questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_questions    FORCE  ROW LEVEL SECURITY;
ALTER TABLE playbook_criteria     ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_criteria     FORCE  ROW LEVEL SECURITY;

CREATE POLICY skill_settings_tenant ON tenant_skill_settings FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY playbooks_tenant ON playbooks FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY playbook_versions_tenant ON playbook_versions FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY playbook_documents_tenant ON playbook_documents FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY playbook_questions_tenant ON playbook_questions FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY playbook_criteria_tenant ON playbook_criteria FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_skill_settings, playbooks, playbook_versions,
  playbook_documents, playbook_questions, playbook_criteria TO sci_app;
