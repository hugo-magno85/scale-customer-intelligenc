-- Envio da análise da reunião ao CRM (comentário, tarefas e campos no registro vinculado).

-- Preferências por conexão: envio automático após a análise e o que enviar.
ALTER TABLE crm_connections ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Rastreabilidade do envio por reunião/análise (status visível na reunião).
ALTER TABLE integration_syncs ADD COLUMN meeting_id uuid;
ALTER TABLE integration_syncs ADD COLUMN analysis_id uuid;
ALTER TABLE integration_syncs
  ADD CONSTRAINT integration_syncs_meeting_fk FOREIGN KEY (tenant_id, meeting_id)
  REFERENCES meetings (tenant_id, id) ON DELETE CASCADE;
CREATE INDEX integration_syncs_meeting_idx ON integration_syncs (tenant_id, meeting_id, created_at DESC);
