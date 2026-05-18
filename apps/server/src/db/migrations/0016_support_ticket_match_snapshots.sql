create table if not exists support_ticket_match_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  snapshot_key text not null,
  match_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, snapshot_key)
);

create index if not exists idx_support_ticket_match_snapshots_match_id_created_at
  on support_ticket_match_snapshots(match_id, created_at desc);

alter table support_tickets
  add column if not exists match_snapshot_key text;

create index if not exists idx_support_tickets_match_snapshot_key
  on support_tickets(match_snapshot_key);
