create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references users(id) on delete set null,
  match_id text not null,
  subject text not null,
  description text not null,
  category text not null default 'BOARD_REPORT' check (category in ('BOARD_REPORT')),
  severity text not null default 'NORMAL' check (severity in ('LOW', 'NORMAL', 'HIGH', 'BLOCKING')),
  status text not null default 'OPEN' check (status in ('OPEN', 'TRIAGED', 'RESOLVED', 'DISMISSED')),
  match_snapshot jsonb not null,
  client_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_status_created_at on support_tickets(status, created_at desc);
create index if not exists idx_support_tickets_reporter_user_id on support_tickets(reporter_user_id);
create index if not exists idx_support_tickets_match_id on support_tickets(match_id);
