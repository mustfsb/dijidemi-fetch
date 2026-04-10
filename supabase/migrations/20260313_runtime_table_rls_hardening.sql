-- Harden sensitive runtime tables for backend-only access.

alter table public.users enable row level security;
alter table public.admin enable row level security;
alter table public.logs enable row level security;
alter table public.ai_log enable row level security;
alter table public.auth_cookies enable row level security;
alter table public.private_test_device_bindings enable row level security;
alter table public.private_test_enrollment_control enable row level security;

revoke all on public.users from anon, authenticated;
revoke all on public.admin from anon, authenticated;
revoke all on public.logs from anon, authenticated;
revoke all on public.ai_log from anon, authenticated;
revoke all on public.auth_cookies from anon, authenticated;
revoke all on public.private_test_device_bindings from anon, authenticated;
revoke all on public.private_test_enrollment_control from anon, authenticated;
