create table if not exists user_sessions (
  sid varchar not null primary key,
  sess json not null,
  expire timestamp(6) not null
);

create index if not exists idx_user_sessions_expire on user_sessions(expire);
