-- UPS Reprice Platform: secure administrator login history
-- Run this once in the Supabase SQL Editor for the production project.

begin;

create table if not exists public.login_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  logged_in_at timestamptz not null default now(),
  user_agent text not null default ''
);

create index if not exists login_history_logged_in_at_idx
  on public.login_history (logged_in_at desc);

create index if not exists login_history_user_id_idx
  on public.login_history (user_id);

alter table public.login_history enable row level security;

-- No browser may write directly to the audit table. The record_login function
-- below derives identity and time from the verified Supabase session.
revoke all on table public.login_history from anon, authenticated;
grant select on table public.login_history to authenticated;

drop policy if exists "Administrators can read login history"
  on public.login_history;

create policy "Administrators can read login history"
  on public.login_history
  for select
  to authenticated
  using (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

create or replace function public.record_login(p_user_agent text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if v_user_id is null or v_email = '' then
    raise exception 'Authentication required';
  end if;

  -- Avoid duplicate rows when the login button or network request is retried.
  if not exists (
    select 1
    from public.login_history
    where user_id = v_user_id
      and logged_in_at > now() - interval '30 seconds'
  ) then
    insert into public.login_history (user_id, email, user_agent)
    values (v_user_id, lower(v_email), left(coalesce(p_user_agent, ''), 500));
  end if;
end;
$$;

revoke all on function public.record_login(text) from public, anon;
grant execute on function public.record_login(text) to authenticated;

comment on table public.login_history is
  'Successful UPS Reprice Platform sign-ins. Readable only by app_metadata.role=admin.';

commit;
