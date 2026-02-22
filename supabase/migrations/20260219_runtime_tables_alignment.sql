-- Runtime table baseline for environments provisioned from migrations only.
-- Uses IF NOT EXISTS so existing production tables are untouched.

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  external_id text unique,
  username text,
  full_name text,
  nickname_credential text unique,
  role text not null default 'user',
  last_login_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.admin (
  username text primary key,
  password text not null default '',
  role text not null default 'user'
);

create table if not exists public.logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  target_id text,
  ip_address text,
  details jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.ai_log (
  id uuid primary key default uuid_generate_v4(),
  username text not null,
  user_prompt text,
  ai_response text,
  question_ids text,
  image_ids text,
  session_title text,
  title text,
  sender text,
  messages jsonb,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.auth_cookies (
  id smallint primary key default 1 check (id = 1),
  cookie_json jsonb not null,
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);
