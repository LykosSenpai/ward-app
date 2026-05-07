update users
set email = username || '@local.ward'
where email is null or btrim(email) = '';

alter table users
  alter column email set not null;
