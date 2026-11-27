-- Fornecedores de IA não aparecem para os clientes: a origem do sinal passa a ser "ai" (motor da
-- plataforma) e avisos já gravados com nomes de fornecedores são reescritos de forma neutra.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'meeting_live_signals'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%jev%'
  LOOP
    EXECUTE format('ALTER TABLE meeting_live_signals DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
UPDATE meeting_live_signals SET source = 'ai' WHERE source = 'jev';
ALTER TABLE meeting_live_signals ADD CONSTRAINT meeting_live_signals_source_check CHECK (source IN ('ai','heuristic'));

CREATE FUNCTION pg_temp.sci_neutral(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
    'o provedor de raciocínio \(DeepSeek\) não está configurado', 'a análise avançada não está disponível neste ambiente', 'g'),
    'o provedor DeepSeek não está configurado neste ambiente\. O texto foi extraído; reprocesse quando a chave estiver configurada',
    'a interpretação automática não está disponível neste ambiente. O texto foi extraído; reprocesse mais tarde', 'g'),
    '\s*\((Jev|DeepSeek|TypeSafe|Deepgram)[^)]*\)', '', 'g'),
    '(DeepSeek|Jev|TypeSafe|Deepgram)', 'motor de IA', 'g')
$$;

UPDATE meeting_analyses SET warnings = ARRAY(SELECT pg_temp.sci_neutral(w) FROM unnest(warnings) w)
  WHERE array_to_string(warnings, ' ') ~ '(DeepSeek|Jev|TypeSafe|Deepgram)';
UPDATE meeting_analyses SET error = pg_temp.sci_neutral(error) WHERE error ~ '(DeepSeek|Jev|TypeSafe|Deepgram)';
UPDATE playbook_versions SET processing_warnings = ARRAY(SELECT pg_temp.sci_neutral(w) FROM unnest(processing_warnings) w)
  WHERE array_to_string(processing_warnings, ' ') ~ '(DeepSeek|Jev|TypeSafe|Deepgram)';
UPDATE playbook_versions SET processing_error = pg_temp.sci_neutral(processing_error)
  WHERE processing_error ~ '(DeepSeek|Jev|TypeSafe|Deepgram)';
