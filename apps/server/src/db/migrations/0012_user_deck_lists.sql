create table if not exists user_deck_lists (
  user_id uuid not null references users(id) on delete cascade,
  deck_id text not null,
  deck_name text not null,
  deck_data jsonb not null,
  card_count integer not null default 0 check (card_count >= 0),
  format text not null default 'FREE_PLAY' check (format in ('FREE_PLAY', 'TOURNAMENT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);

create index if not exists idx_user_deck_lists_user_updated
  on user_deck_lists (user_id, updated_at desc);
