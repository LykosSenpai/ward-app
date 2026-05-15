create table if not exists marketplace_posts (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  game_id text not null,
  card_id text not null,
  quantity integer not null check (quantity > 0),
  listing_type text not null check (listing_type in ('TRADE_ONLY','SELL_ONLY','TRADE_OR_SELL')),
  status text not null check (status in ('OPEN','PENDING','CLOSED')),
  preferred_return text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketplace_posts_user_id on marketplace_posts(user_id);
create index if not exists idx_marketplace_posts_card_id on marketplace_posts(card_id);
create index if not exists idx_marketplace_posts_status on marketplace_posts(status);

create table if not exists marketplace_wants (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  game_id text not null,
  card_id text not null,
  desired_quantity integer not null check (desired_quantity > 0),
  priority text not null check (priority in ('LOW','MEDIUM','HIGH','TOP')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketplace_wants_user_id on marketplace_wants(user_id);
create index if not exists idx_marketplace_wants_card_id on marketplace_wants(card_id);

create table if not exists marketplace_trade_offers (
  id text primary key,
  created_by_user_id uuid not null references users(id) on delete cascade,
  recipient_user_id uuid not null references users(id) on delete cascade,
  status text not null check (status in ('DRAFT','SENT','ACCEPTED','REJECTED','COUNTERED','CANCELED','COMPLETED_MANUALLY')),
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketplace_trade_offers_creator on marketplace_trade_offers(created_by_user_id);
create index if not exists idx_marketplace_trade_offers_recipient on marketplace_trade_offers(recipient_user_id);

create table if not exists marketplace_message_threads (
  id text primary key,
  related_post_id text,
  related_trade_offer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists marketplace_message_thread_participants (
  id text primary key,
  thread_id text not null references marketplace_message_threads(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  unique (thread_id, user_id)
);

create index if not exists idx_marketplace_thread_participants_user on marketplace_message_thread_participants(user_id);

create table if not exists marketplace_messages (
  id text primary key,
  thread_id text not null references marketplace_message_threads(id) on delete cascade,
  sender_user_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_marketplace_messages_thread on marketplace_messages(thread_id);

create table if not exists marketplace_match_statuses (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  status text not null check (status in ('NEW','VIEWED','SAVED','DISMISSED')),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketplace_match_statuses_user on marketplace_match_statuses(user_id);
