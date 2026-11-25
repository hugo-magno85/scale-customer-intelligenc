-- 0002 — Manutenção: remoção de sessões expiradas/revogadas (política de retenção).
CREATE OR REPLACE FUNCTION app.purge_expired_sessions(p_grace interval DEFAULT interval '7 days')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM sessions
  WHERE expires_at < now() - p_grace
     OR (revoked_at IS NOT NULL AND revoked_at < now() - p_grace);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION app.purge_expired_sessions(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_expired_sessions(interval) TO sci_app;
