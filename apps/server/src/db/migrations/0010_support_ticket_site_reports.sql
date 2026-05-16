alter table support_tickets
  drop constraint if exists support_tickets_category_check;

alter table support_tickets
  add constraint support_tickets_category_check
  check (category in ('BOARD_REPORT', 'SITE_REPORT'));

create index if not exists idx_support_tickets_category_status_created_at
  on support_tickets(category, status, created_at desc);
