create table if not exists marketplace_auto_need_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  generation text not null,
  include_variants boolean not null default false,
  quantity_policy text not null check (quantity_policy in ('ONE_PER_CARD', 'DECK_LIMIT')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, generation, include_variants, quantity_policy)
);

create table if not exists marketplace_needs (
  user_id uuid not null references users(id) on delete cascade,
  ownership_key text not null,
  needed_count integer not null check (needed_count > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, ownership_key)
);
