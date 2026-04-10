-- Add immutable user ownership to ai_log and backfill from existing identifiers.

alter table public.ai_log
  add column if not exists user_id uuid references public.users(id) on delete cascade;

update public.ai_log as log
set user_id = users.id
from public.users as users
where log.user_id is null
  and (
    log.username = users.id::text
    or log.username = users.username
    or log.username = users.external_id
  );

create index if not exists ai_log_user_id_idx on public.ai_log(user_id);
