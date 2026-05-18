create table if not exists admin_feature_flags (
  key text primary key,
  enabled_for_players boolean not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references users(id) on delete set null
);

create index if not exists idx_admin_feature_flags_updated_at
  on admin_feature_flags(updated_at desc);
