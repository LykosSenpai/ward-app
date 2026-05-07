create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text unique,
  password_hash text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_card_ownership (
  user_id uuid not null references users(id) on delete cascade,
  card_id text not null,
  art_key text not null default 'default',
  owned_count integer not null default 0 check (owned_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id, art_key)
);

create table if not exists decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists deck_cards (
  deck_id uuid not null references decks(id) on delete cascade,
  card_id text not null,
  art_key text not null default 'default',
  quantity integer not null check (quantity > 0),
  primary key (deck_id, card_id, art_key)
);

create table if not exists lobbies (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references users(id) on delete cascade,
  name text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_MATCH', 'CLOSED')),
  selected_pack_ids text[] not null default array[]::text[],
  match_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lobby_players (
  lobby_id uuid not null references lobbies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  seat integer not null check (seat > 0),
  selected_deck_id uuid references decks(id) on delete set null,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id),
  unique (lobby_id, seat)
);

create index if not exists idx_decks_user_id on decks(user_id);
create index if not exists idx_lobbies_status on lobbies(status);
create index if not exists idx_lobby_players_user_id on lobby_players(user_id);
