-- Group chat provenance on interactions.
--
-- Group conversations are rendered as their own "## Group: <name>" section in
-- each People/*.md file, rather than mixed into the 1:1 Interaction Log.
-- group_jid identifies the chat; group_name is captured at sweep time so the
-- section heading survives even if the group is later renamed or left.
--
-- NULL group_jid means a 1:1 conversation, which is every existing row.

alter table kit.interaction_log
  add column if not exists group_jid  text,
  add column if not exists group_name text;

create index if not exists idx_interaction_log_group
  on kit.interaction_log (contact_id, group_jid);
