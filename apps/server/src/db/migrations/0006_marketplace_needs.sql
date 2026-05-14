create table if not exists user_marketplace_auto_need_rules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  enabled boolean not null default true,
  desired_quantity_per_card integer not null default 1,
  selected_generations text[] not null default '{}',
  selected_art_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_marketplace_needs (
  user_id text not null references users(id) on delete cascade,
  card_id text not null,
  art_key text not null,
  needed_count integer not null,
  source_kind text not null,
  source_rule_id text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id, art_key, source_kind, source_rule_id)
);
