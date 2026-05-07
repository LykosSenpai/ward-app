alter table users
  add column if not exists role text not null default 'PLAYER'
    check (role in ('PLAYER', 'DEVELOPER', 'ADMIN')),
  add column if not exists dev_tools_enabled boolean not null default false;
