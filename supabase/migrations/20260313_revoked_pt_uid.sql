-- Server-side revocation list for signed pt_uid cookies.

create table if not exists public.revoked_pt_uid (
  token_key text primary key,
  revoked_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table public.revoked_pt_uid enable row level security;
revoke all on public.revoked_pt_uid from anon, authenticated;

create index if not exists revoked_pt_uid_revoked_at_idx
  on public.revoked_pt_uid(revoked_at desc);
