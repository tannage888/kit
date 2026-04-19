-- Kit WhatsApp Sweep State
-- Tracks per-contact watermarks for the scheduled history sweep.
-- last_message_ts is the epoch-ms of the most recent message processed,
-- used as the cursor for the next run (avoids reprocessing old messages).

create table if not exists wa_sweep_state (
  contact_id      text        not null primary key references contacts(id) on delete cascade,
  last_swept_at   timestamptz not null default now(),
  last_message_ts bigint      null,     -- epoch ms; null = never swept
  messages_found  int         not null default 0,
  updated_at      timestamptz not null default now()
);

-- Auto-update updated_at on row change
create or replace function update_wa_sweep_state_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger wa_sweep_state_updated_at
  before update on wa_sweep_state
  for each row execute function update_wa_sweep_state_updated_at();

comment on table wa_sweep_state is
  'Per-contact watermarks for the Kit WhatsApp history sweep scheduler.';
