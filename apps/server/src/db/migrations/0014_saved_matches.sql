create table if not exists saved_matches (
  match_id text primary key,
  match_state jsonb not null,
  format text not null,
  turn_number integer not null,
  turn_cycle_number integer not null,
  active_player_id text not null,
  phase text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saved_matches_updated_at
  on saved_matches (updated_at desc);
