create table if not exists public.private_test_device_bindings (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null,
  browser_name text not null,
  browser_major integer not null,
  user_agent text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  last_seen_at timestamp with time zone not null default timezone('utc'::text, now()),
  revoked_at timestamp with time zone
);

create unique index if not exists private_test_device_bindings_user_active_idx
  on public.private_test_device_bindings(user_id)
  where revoked_at is null;

create unique index if not exists private_test_device_bindings_token_active_idx
  on public.private_test_device_bindings(token_hash)
  where revoked_at is null;

create index if not exists private_test_device_bindings_last_seen_idx
  on public.private_test_device_bindings(last_seen_at desc);
