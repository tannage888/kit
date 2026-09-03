-- Provenance for messages Kit sent itself.
--
-- send-message logs its own interaction the moment the message leaves, but the
-- 3-hourly sweep then reads that same outbound message back off WhatsApp and
-- summarises it as a second, independent interaction. Graham Boutilier's file
-- carried both for 2026-09-01: the "Sent via WhatsApp: ..." row written at
-- 14:35, and a sweep summary of the same exchange written at 07:11 the next
-- morning.
--
-- Recording which WhatsApp message a row represents lets the sweep recognise
-- what it has already logged and skip it. NULL means the row did not come from
-- a single identifiable message — every sweep summary and manual log entry.
--
-- Deliberately not a unique constraint: a sweep summary covers many messages
-- and stores no id, so NULLs are the common case and uniqueness would only
-- constrain the send path it is meant to describe.

alter table kit.interaction_log
  add column if not exists wa_message_id text;

create index if not exists idx_interaction_log_wa_message_id
  on kit.interaction_log (contact_id, wa_message_id)
  where wa_message_id is not null;
