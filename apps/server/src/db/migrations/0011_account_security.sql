alter table users
  add column if not exists email_verified_at timestamptz;

create table if not exists user_security_settings (
  user_id uuid primary key references users(id) on delete cascade,
  pending_email text,
  pending_email_requested_at timestamptz,
  totp_secret_ciphertext text,
  totp_enabled_at timestamptz,
  totp_pending_secret_ciphertext text,
  totp_pending_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_security_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('PASSWORD_RESET', 'EMAIL_VERIFY')),
  token_hash text not null unique,
  target_email text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_auth_security_tokens_user_purpose
  on auth_security_tokens(user_id, purpose, created_at desc);

create index if not exists idx_auth_security_tokens_expires
  on auth_security_tokens(expires_at);

create table if not exists auth_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('TOTP', 'NEW_DEVICE_EMAIL')),
  code_hash text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0,
  trust_device boolean not null default false,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_auth_login_challenges_user_type
  on auth_login_challenges(user_id, type, created_at desc);

create index if not exists idx_auth_login_challenges_expires
  on auth_login_challenges(expires_at);

create table if not exists auth_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_auth_trusted_devices_user
  on auth_trusted_devices(user_id, last_seen_at desc);

create index if not exists idx_auth_trusted_devices_expires
  on auth_trusted_devices(expires_at);

create table if not exists user_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_recovery_codes_user
  on user_recovery_codes(user_id, used_at);
