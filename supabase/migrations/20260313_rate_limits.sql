-- Shared Postgres-backed rate limiting for serverless instances.

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at timestamp with time zone not null,
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create index if not exists rate_limits_reset_at_idx
  on public.rate_limits(reset_at asc);

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamp with time zone := timezone('utc'::text, now());
  v_count integer;
  v_reset_at timestamp with time zone;
begin
  if p_key is null or btrim(p_key) = '' then
    raise exception 'p_key is required';
  end if;

  if p_limit is null or p_limit <= 0 then
    raise exception 'p_limit must be positive';
  end if;

  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'p_window_seconds must be positive';
  end if;

  insert into public.rate_limits as limits (key, count, reset_at, updated_at)
  values (
    p_key,
    1,
    v_now + make_interval(secs => p_window_seconds),
    v_now
  )
  on conflict (key) do update
  set count = case
      when limits.reset_at <= v_now then 1
      else limits.count + 1
    end,
    reset_at = case
      when limits.reset_at <= v_now then v_now + make_interval(secs => p_window_seconds)
      else limits.reset_at
    end,
    updated_at = v_now
  returning limits.count, limits.reset_at
  into v_count, v_reset_at;

  return query
  select
    v_count <= p_limit as allowed,
    greatest(p_limit - v_count, 0) as remaining,
    v_reset_at as reset_at;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
