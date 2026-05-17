create table if not exists marketplace_socket_posts (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  post_data jsonb not null,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketplace_socket_posts_user_updated
  on marketplace_socket_posts (user_id, updated_at desc);

create index if not exists idx_marketplace_socket_posts_status_updated
  on marketplace_socket_posts (status, updated_at desc);

create table if not exists marketplace_socket_transactions (
  id text primary key,
  requester_user_id uuid not null references users(id) on delete cascade,
  responder_user_id uuid not null references users(id) on delete cascade,
  transaction_data jsonb not null,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketplace_socket_transactions_requester_updated
  on marketplace_socket_transactions (requester_user_id, updated_at desc);

create index if not exists idx_marketplace_socket_transactions_responder_updated
  on marketplace_socket_transactions (responder_user_id, updated_at desc);

create index if not exists idx_marketplace_socket_transactions_status_expires
  on marketplace_socket_transactions (status, expires_at);
