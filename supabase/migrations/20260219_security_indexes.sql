-- Performance + abuse-resilience indexes for frequently queried paths.

create index if not exists users_external_id_idx
  on public.users(external_id);

create index if not exists users_username_idx
  on public.users(username);

create index if not exists admin_username_idx
  on public.admin(username);

create index if not exists logs_created_at_idx
  on public.logs(created_at desc);

create index if not exists logs_user_id_created_at_idx
  on public.logs(user_id, created_at desc);

create index if not exists logs_event_type_created_at_idx
  on public.logs(event_type, created_at desc);

create index if not exists homeworks_identifier_idx
  on public.homeworks(homework_identifier);

create index if not exists homeworks_status_created_at_idx
  on public.homeworks(status, created_at desc);

create index if not exists ai_log_username_created_at_idx
  on public.ai_log(username, created_at desc);

create index if not exists auth_cookies_updated_at_idx
  on public.auth_cookies(updated_at desc);
