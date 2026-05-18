create table if not exists support_ticket_archives (
  id uuid primary key default gen_random_uuid(),
  archive_kind text not null check (archive_kind in ('MONTHLY', 'YEARLY')),
  period_start date not null,
  period_end date not null,
  ticket_count integer not null check (ticket_count >= 0),
  snapshot_count integer not null check (snapshot_count >= 0),
  compression text not null default 'brotli-json',
  payload_sha256 text not null,
  payload bytea not null,
  created_at timestamptz not null default now(),
  unique (archive_kind, period_start, period_end)
);

create index if not exists idx_support_ticket_archives_period
  on support_ticket_archives (archive_kind, period_start desc);

create table if not exists support_ticket_archive_items (
  archive_id uuid not null references support_ticket_archives(id) on delete cascade,
  ticket_id uuid not null,
  match_id text not null,
  ticket_category text not null,
  ticket_status text not null,
  ticket_created_at timestamptz not null,
  primary key (archive_id, ticket_id)
);

create index if not exists idx_support_ticket_archive_items_match
  on support_ticket_archive_items (match_id);

create index if not exists idx_support_ticket_archive_items_ticket
  on support_ticket_archive_items (ticket_id);
