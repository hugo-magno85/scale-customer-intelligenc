-- =====================================================================
-- 0007 — CRM Integration Hub (fundação): conexões com credenciais cifradas,
-- registros externos, vínculo reunião ↔ CRM com histórico, sincronizações.
-- =====================================================================

CREATE TABLE crm_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider               text NOT NULL CHECK (provider IN ('bitrix24','pipedrive','rdstation','zoho')),
  label                  text NOT NULL CHECK (length(label) BETWEEN 2 AND 120),
  -- identificador da conta no CRM (portal, domínio da empresa, organização)
  external_account_id    text NOT NULL CHECK (length(external_account_id) BETWEEN 1 AND 255),
  auth_type              text NOT NULL CHECK (auth_type IN ('oauth','api_token','webhook')),
  -- credenciais cifradas com AES-256-GCM (AAD = tenant); nunca retornadas pela API
  encrypted_credentials  text,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','error','disabled')),
  last_validated_at      timestamptz,
  last_error             text,
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider, external_account_id)
);
CREATE TRIGGER crm_connections_touch BEFORE UPDATE ON crm_connections FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Vínculo da reunião com um registro do CRM. Um ativo por reunião; trocas ficam no histórico.
CREATE TABLE meeting_crm_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  meeting_id           uuid NOT NULL,
  connection_id        uuid,
  provider             text NOT NULL CHECK (provider IN ('bitrix24','pipedrive','rdstation','zoho')),
  external_account_id  text,
  entity_type          text NOT NULL CHECK (entity_type IN ('deal','company','contact','lead')),
  external_record_id   text NOT NULL CHECK (length(external_record_id) BETWEEN 1 AND 128),
  record_url           text,
  customer_id          uuid,
  contact_id           uuid,
  -- dados do registro consultados no CRM (empresa, negócio, contato, responsável)
  record_snapshot      jsonb,
  validation_status    text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','validated','failed')),
  validation_error     text,
  validated_at         timestamptz,
  origin               text NOT NULL CHECK (origin IN ('automatic','manual')),
  user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  active               boolean NOT NULL DEFAULT true,
  replaced_at          timestamptz,
  replaced_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, connection_id) REFERENCES crm_connections (tenant_id, id) ON DELETE SET NULL (connection_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE SET NULL (contact_id)
);
CREATE UNIQUE INDEX meeting_crm_links_active ON meeting_crm_links (meeting_id) WHERE active;

-- Registro de cada operação com o CRM: idempotência, tentativas e resultado.
CREATE TABLE integration_syncs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  connection_id    uuid,
  operation        text NOT NULL,
  idempotency_key  text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','needs_approval','cancelled')),
  attempts         integer NOT NULL DEFAULT 0,
  request_summary  jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary   jsonb,
  error            text,
  requested_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES crm_connections (tenant_id, id) ON DELETE SET NULL (connection_id)
);
CREATE TRIGGER integration_syncs_touch BEFORE UPDATE ON integration_syncs FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_connections','meeting_crm_links','integration_syncs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sci_app', t);
  END LOOP;
END $$;
