create table if not exists public.private_test_enrollment_control (
  id smallint primary key default 1 check (id = 1),
  is_open boolean not null default false,
  enrollment_until timestamp with time zone,
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_by text
);

insert into public.private_test_enrollment_control (id, is_open, enrollment_until, updated_by)
values (1, false, null, 'system')
on conflict (id) do nothing;

create or replace function public.touch_private_test_enrollment_control_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_private_test_enrollment_control_updated_at on public.private_test_enrollment_control;

create trigger trg_private_test_enrollment_control_updated_at
before update on public.private_test_enrollment_control
for each row execute procedure public.touch_private_test_enrollment_control_updated_at();
