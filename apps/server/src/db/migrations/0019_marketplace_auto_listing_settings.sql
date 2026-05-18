create table if not exists user_marketplace_auto_listing_settings (
  user_id uuid primary key references users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_marketplace_auto_listing_settings_updated
  on user_marketplace_auto_listing_settings (updated_at desc);
