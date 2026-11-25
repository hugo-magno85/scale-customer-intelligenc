-- =====================================================================
-- 0004 — Reuniões, participantes, consentimento e transcrição
-- Áudio bruto NÃO é armazenado; apenas segmentos finais de transcrição.
-- =====================================================================

CREATE TABLE meetings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id         uuid NOT NULL,
  customer_id           uuid,
  playbook_version_id   uuid,
  skill_version         text REFERENCES cs_skill_versions(version),
  platform              text NOT NULL CHECK (platform IN ('google_meet','zoom','teams','other')),
  external_ref          text,
  title                 text,
  meeting_type          text NOT NULL DEFAULT 'other' CHECK (meeting_type IN ('onboarding','follow_up','results_review','satisfaction','at_risk_recovery','retention','expansion','executive_review','other')),
  objective             text,
  status                text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','live','ended','analyzed')),
  consent_method        text CHECK (consent_method IN ('verbal_announcement','written','platform_notice')),
  consent_confirmed_at  timestamptz,
  consent_confirmed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at            timestamptz,
  ended_at              timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES tenant_memberships (tenant_id, user_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (tenant_id, playbook_version_id) REFERENCES playbook_versions (tenant_id, id),
  CHECK ((consent_confirmed_at IS NULL) = (consent_method IS NULL)),
  CHECK (status = 'preparing' OR consent_confirmed_at IS NOT NULL)
);
CREATE INDEX meetings_tenant_created_idx ON meetings (tenant_id, created_at DESC);
CREATE INDEX meetings_customer_idx ON meetings (tenant_id, customer_id);
CREATE TRIGGER meetings_touch BEFORE UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- A versão de playbook usada na reunião precisa estar publicada no momento do vínculo.
CREATE OR REPLACE FUNCTION app.meeting_playbook_published() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.playbook_version_id IS NOT NULL
     AND NEW.playbook_version_id IS DISTINCT FROM COALESCE(OLD.playbook_version_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND NOT EXISTS (SELECT 1 FROM playbook_versions v WHERE v.id = NEW.playbook_version_id AND v.status = 'published') THEN
    RAISE EXCEPTION 'apenas versões publicadas podem ser usadas em reuniões' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meetings_playbook_published BEFORE INSERT OR UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION app.meeting_playbook_published();

CREATE TABLE meeting_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  meeting_id    uuid NOT NULL,
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  email         text,
  role          text NOT NULL DEFAULT 'unknown' CHECK (role IN ('internal','customer','unknown')),
  contact_id    uuid,
  source        text NOT NULL CHECK (source IN ('platform','manual')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX meeting_participants_meeting_idx ON meeting_participants (tenant_id, meeting_id);

-- Segmentos finais da transcrição. channel 0 = microfone (profissional), 1 = áudio da aba (cliente).
CREATE TABLE meeting_transcript_segments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  meeting_id  uuid NOT NULL,
  channel     smallint NOT NULL CHECK (channel IN (0, 1)),
  speaker     text NOT NULL CHECK (speaker IN ('internal','customer')),
  start_ms    integer NOT NULL CHECK (start_ms >= 0),
  end_ms      integer NOT NULL CHECK (end_ms >= start_ms),
  text        text NOT NULL,
  confidence  real,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX transcript_meeting_idx ON meeting_transcript_segments (tenant_id, meeting_id, start_ms);

-- Tickets de uso único para abrir o WebSocket de áudio (navegador não envia headers em WS).
CREATE TABLE meeting_stream_tickets (
  token_hash  text PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  meeting_id  uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE
);

-- Consome o ticket atomicamente (sem conhecer o tenant de antemão).
CREATE OR REPLACE FUNCTION app.consume_stream_ticket(p_token_hash text)
RETURNS TABLE (tenant_id uuid, meeting_id uuid, user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE meeting_stream_tickets t SET used_at = now()
  WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
  RETURNING t.tenant_id, t.meeting_id, t.user_id
$$;
REVOKE ALL ON FUNCTION app.consume_stream_ticket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.consume_stream_ticket(text) TO sci_app;

ALTER TABLE meetings                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings                    FORCE  ROW LEVEL SECURITY;
ALTER TABLE meeting_participants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_participants        FORCE  ROW LEVEL SECURITY;
ALTER TABLE meeting_transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_transcript_segments FORCE  ROW LEVEL SECURITY;
-- tickets: RLS habilitado (não forçado) para a função SECURITY DEFINER consumir
ALTER TABLE meeting_stream_tickets      ENABLE ROW LEVEL SECURITY;

CREATE POLICY meetings_tenant ON meetings FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY meeting_participants_tenant ON meeting_participants FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY transcript_tenant ON meeting_transcript_segments FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY stream_tickets_tenant ON meeting_stream_tickets FOR ALL
  USING (tenant_id = app.current_tenant() AND user_id = app.current_user_id())
  WITH CHECK (tenant_id = app.current_tenant() AND user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON meetings, meeting_participants TO sci_app;
GRANT SELECT, INSERT, DELETE ON meeting_transcript_segments TO sci_app;
GRANT SELECT, INSERT ON meeting_stream_tickets TO sci_app;
