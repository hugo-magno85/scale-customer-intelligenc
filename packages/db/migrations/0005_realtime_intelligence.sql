-- =====================================================================
-- 0005 — Inteligência em tempo real: sugestões, sinais ao vivo, notas, checklist
-- =====================================================================

ALTER TABLE meetings ADD COLUMN checklist jsonb;

CREATE TABLE intelligence_suggestions (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL,
  meeting_id             uuid NOT NULL,
  question               text NOT NULL,
  reason                 text NOT NULL,
  objective              text NOT NULL,
  type                   text NOT NULL,
  indicator              text,
  priority               text NOT NULL CHECK (priority IN ('high','medium','low')),
  playbook_question_key  text,
  candidate_key          text NOT NULL,
  evidence_segment_id    bigint,
  evidence_text          text,
  evidence_speaker       text CHECK (evidence_speaker IN ('internal','customer')),
  status                 text NOT NULL CHECK (status IN ('shown','done','ignored','replaced')),
  adapted_by             text,
  created_at             timestamptz NOT NULL,
  resolved_at            timestamptz,
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX suggestions_meeting_idx ON intelligence_suggestions (tenant_id, meeting_id, created_at);

CREATE TABLE meeting_live_signals (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL,
  meeting_id           uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('risk','opportunity','need')),
  key                  text NOT NULL,
  label                text NOT NULL,
  confidence           real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_segment_id  bigint,
  evidence_text        text NOT NULL,
  evidence_speaker     text,
  source               text NOT NULL CHECK (source IN ('jev','heuristic')),
  created_at           timestamptz NOT NULL,
  UNIQUE (meeting_id, kind, key),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE meeting_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  meeting_id     uuid NOT NULL,
  author_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  suggestion_id  uuid REFERENCES intelligence_suggestions(id) ON DELETE SET NULL,
  text           text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, meeting_id) REFERENCES meetings (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE intelligence_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_suggestions FORCE  ROW LEVEL SECURITY;
ALTER TABLE meeting_live_signals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_live_signals     FORCE  ROW LEVEL SECURITY;
ALTER TABLE meeting_notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_notes            FORCE  ROW LEVEL SECURITY;
CREATE POLICY suggestions_tenant ON intelligence_suggestions FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY live_signals_tenant ON meeting_live_signals FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY notes_tenant ON meeting_notes FOR ALL
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT, INSERT, UPDATE ON intelligence_suggestions, meeting_live_signals TO sci_app;
GRANT SELECT, INSERT ON meeting_notes TO sci_app;
