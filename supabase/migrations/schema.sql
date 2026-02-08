-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table (extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  username text unique,
  full_name text,
  avatar_url text,
  role text default 'user' check (role in ('user', 'admin')),
  nickname_credential text unique, -- For secondary login
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Turn on RLS
alter table public.profiles enable row level security;

-- Policies for profiles
create policy "Public profiles are viewable by everyone." on public.profiles
  for select using (true);

create policy "Users can insert their own profile." on public.profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on public.profiles
  for update using (auth.uid() = id);

-- Activity Logs
create table if not exists public.activity_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id),
  action_type text not null, -- 'LOGIN', 'LOGOUT', 'TEST_SAVED', 'ANSWER_KEY_VIEWED'
  details jsonb, -- e.g., which test, which IP
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.activity_logs enable row level security;

-- Only admins can view logs
create policy "Admins can view all logs" on public.activity_logs
  for select using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Users can insert logs (server-side mostly, but allowing for now)
create policy "Users can insert logs" on public.activity_logs
  for insert with check (auth.uid() = user_id);


-- Homework Management
create table if not exists public.homeworks (
  id uuid default uuid_generate_v4() primary key,
  homework_identifier text not null, -- The "ID" entered by admin
  status text default 'active' check (status in ('active', 'deactive')),
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.homeworks enable row level security;

-- Admins full access to homeworks
create policy "Admins full access homeworks" on public.homeworks
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role = 'admin'
    )
  );

-- Everyone can view active homeworks (for students to see/do them)
create policy "View active homeworks" on public.homeworks
  for select using (status = 'active');


-- Chat Sessions (AI Playground)
create table if not exists public.chat_sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) not null,
  title text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.chat_sessions enable row level security;

create policy "Users can manage own chat sessions" on public.chat_sessions
  for all using (auth.uid() = user_id);


-- Chat Messages
create table if not exists public.chat_messages (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references public.chat_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'model', 'system')),
  content text not null,
  metadata jsonb, -- Store selected question references here
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.chat_messages enable row level security;

create policy "Users can manage own chat messages" on public.chat_messages
  for all using (
    exists (
      select 1 from public.chat_sessions
      where chat_sessions.id = session_id and chat_sessions.user_id = auth.uid()
    )
  );

-- Triggers for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profiles_updated
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger on_homeworks_updated
  before update on public.homeworks
  for each row execute procedure public.handle_updated_at();
