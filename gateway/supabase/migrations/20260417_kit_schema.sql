-- Move Kit tables from public schema to kit schema.
--
-- Tables moved: contacts, follow_ups, interaction_log, kit_meta, wa_sweep_state
-- The thoughts table (Open Brain) stays in public.
--
-- After applying this migration, run in Supabase SQL editor or via CLI:
--   supabase db push

-- 1. Create kit schema
CREATE SCHEMA IF NOT EXISTS kit;

-- 2. Move tables (preserves all data, indexes, foreign keys, triggers)
ALTER TABLE public.contacts        SET SCHEMA kit;
ALTER TABLE public.follow_ups      SET SCHEMA kit;
ALTER TABLE public.interaction_log SET SCHEMA kit;
ALTER TABLE public.kit_meta        SET SCHEMA kit;
ALTER TABLE public.wa_sweep_state  SET SCHEMA kit;

-- 3. Move the wa_sweep_state trigger function into kit and rewire the trigger
CREATE OR REPLACE FUNCTION kit.update_wa_sweep_state_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wa_sweep_state_updated_at ON kit.wa_sweep_state;

CREATE TRIGGER wa_sweep_state_updated_at
  BEFORE UPDATE ON kit.wa_sweep_state
  FOR EACH ROW EXECUTE FUNCTION kit.update_wa_sweep_state_updated_at();

DROP FUNCTION IF EXISTS public.update_wa_sweep_state_updated_at();

-- 4. Grant permissions (anon for app reads, service_role for gateway writes)
GRANT USAGE ON SCHEMA kit TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA kit TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA kit TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA kit
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA kit
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 5. Expose kit schema through PostgREST so the JS client can reach it
ALTER ROLE authenticator SET pgrst.db_schemas TO 'public, kit';
NOTIFY pgrst, 'reload config';
