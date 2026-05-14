alter table users
  add column if not exists discord_user_id text unique,
  add column if not exists discord_username text,
  add column if not exists discord_global_name text,
  add column if not exists discord_avatar text,
  add column if not exists discord_linked_at timestamptz;

create index if not exists idx_users_discord_user_id on users(discord_user_id);
