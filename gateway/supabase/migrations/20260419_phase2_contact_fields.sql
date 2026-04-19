-- Phase 2: new contact fields for relationship context and WhatsApp capture opt-in
-- All columns are nullable (except whatsapp_capture which has a safe default)
-- so existing rows continue to work without a data backfill.

ALTER TABLE kit.contacts
  ADD COLUMN IF NOT EXISTS special_interests  TEXT,
  ADD COLUMN IF NOT EXISTS sensitive_topics   TEXT,
  ADD COLUMN IF NOT EXISTS preferred_channel  TEXT,
  ADD COLUMN IF NOT EXISTS birthday           DATE,
  ADD COLUMN IF NOT EXISTS whatsapp_capture   TEXT NOT NULL DEFAULT 'disabled'
    CHECK (whatsapp_capture IN ('enabled', 'disabled'));
