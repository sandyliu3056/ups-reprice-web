-- UPS Reprice — 每個帳號自己的費率 + 主帳號管理使用者
-- 在 Supabase 後台 SQL Editor 整份貼上執行一次。可重複執行。
--
-- 兩張表:
--   profiles       每個帳號一列,給主帳號看清單用(email、角色、建立時間)
--   user_settings  每個帳號一列,裝那個帳號自己的費率設定
--
-- 角色的真正來源是 auth.users.raw_app_meta_data->>'role' —— 那一欄只有
-- service_role 改得動,所以權限規則都讀它。profiles.role 只是給畫面顯示的
-- 副本,由觸發器同步,改它不會讓任何人變成管理者。

-- 註:Admin 分頁的帳號清單直接問 auth.users(Edge Function 用 service_role
-- 呼叫 listUsers),不讀 profiles —— 觸發器建立之前就存在的帳號不會在
-- profiles 裡,那會變成「登得進去卻不在清單上」。profiles 留著是給日後
-- 需要用 SQL 查名單時方便,不是清單的來源。

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,          -- 認證用的那個 email(帳號補成的),不是聯絡信箱
  username    text,          -- 登入用的帳號
  name        text,          -- 顯示名稱
  contact_email text,        -- 選填的聯絡信箱
  role        text not null default 'user',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- 舊版建過這張表的話,把新欄位補上。
alter table public.profiles add column if not exists username      text;
alter table public.profiles add column if not exists name          text;
alter table public.profiles add column if not exists contact_email text;

-- 建立/更新帳號時自動同步一列過來。
create or replace function public.sync_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, name, contact_email,
                               role, created_at, updated_at)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'username',
                   split_part(new.email, '@', 1)),
          coalesce(new.raw_user_meta_data->>'display_name',
                   new.raw_user_meta_data->>'full_name',
                   split_part(new.email, '@', 1)),
          new.raw_user_meta_data->>'contact_email',
          coalesce(new.raw_app_meta_data->>'role', 'user'),
          coalesce(new.created_at, now()), now())
  on conflict (id) do update
    set email = excluded.email,
        username = excluded.username,
        name = excluded.name,
        contact_email = excluded.contact_email,
        role  = excluded.role,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_synced on auth.users;
create trigger on_auth_user_synced
  after insert or update on auth.users
  for each row execute function public.sync_profile();

-- 已經存在的帳號補進來(第一次執行時有用)。
insert into public.profiles (id, email, username, name, contact_email,
                             role, created_at, updated_at)
select u.id, u.email,
       coalesce(u.raw_user_meta_data->>'username', split_part(u.email,'@',1)),
       coalesce(u.raw_user_meta_data->>'display_name',
                u.raw_user_meta_data->>'full_name',
                split_part(u.email,'@',1)),
       u.raw_user_meta_data->>'contact_email',
       coalesce(u.raw_app_meta_data->>'role','user'),
       coalesce(u.created_at, now()), now()
from auth.users u
on conflict (id) do update
  set email = excluded.email, username = excluded.username,
      name = excluded.name, contact_email = excluded.contact_email,
      role = excluded.role, updated_at = now();

-- ----------------------------------------------------------- user_settings
create table if not exists public.user_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  config      jsonb,
  config_name text,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- 權限
-- 讀 JWT 裡的角色。app_metadata 只有 service_role 寫得動,所以這是可信的。
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb
      -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists profiles_read_self  on public.profiles;
drop policy if exists profiles_read_admin on public.profiles;
create policy profiles_read_self  on public.profiles
  for select using (id = auth.uid());
create policy profiles_read_admin on public.profiles
  for select using (public.is_admin());
-- 寫入一律走 Edge Function(service_role),前端沒有 insert/update 權限。

drop policy if exists settings_rw_self  on public.user_settings;
drop policy if exists settings_rw_admin on public.user_settings;
-- 自己的費率:自己讀、自己寫。
create policy settings_rw_self on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 主帳號:每個帳號的費率都讀得到、也改得動。
create policy settings_rw_admin on public.user_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------- 把自己設成主帳號
-- 第一個管理者要用 service_role 指定,前端做不到也不該做得到。
-- 在 SQL Editor 執行(把 email 換成你的):
--
--   update auth.users
--      set raw_app_meta_data =
--          coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'::jsonb
--    where email = 'sandyliu3056@gmail.com';
--
-- 改完要重新登入一次,JWT 才會帶上新的角色。
