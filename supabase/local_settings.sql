-- UPS Reprice — 本機帳號模式的設定同步
-- 在 Supabase 後台 SQL Editor 整份貼上執行一次。可重複執行。
--
-- 背景:網站目前用本機帳號登入(index.html 的 LOCAL_MODE),沒有 Supabase
-- 登入身分可用。設定要跨電腦跟著帳號走,所以另外開一張表:
--
--   local_settings   一把「同步鑰匙」一列,裝那把鑰匙對應的設定
--
-- 鑰匙是瀏覽器在登入當下用 sha256("cfg-sync::" + 帳號 + "::" + 密碼) 算的。
-- 不知道密碼就算不出鑰匙;repo 裡公開的登入雜湊是另一種算法,推不出這把。
-- 換密碼等於換一把新鑰匙 —— 舊設定不會跟過來,重新儲存一次即可。
--
-- 安全設計:這張表「沒有」任何 RLS policy,anon 完全不能直接讀寫,
-- 唯一的入口是下面兩個 security definer 函式 —— get 一定要給出完整的
-- 鑰匙才拿得到那一列,沒有任何列清單的路。等於憑密碼取物的置物櫃。

create table if not exists public.local_settings (
  sync_key    text primary key,
  config      jsonb,
  config_name text,
  updated_at  timestamptz not null default now()
);

alter table public.local_settings enable row level security;
-- 不建任何 policy:直接走 REST 的讀寫一律被 RLS 擋下。
revoke all on table public.local_settings from anon, authenticated;

-- 讀:給鑰匙,拿那一列。鑰匙必須是 64 位十六進位(sha256),擋掉亂餵的值。
create or replace function public.local_settings_get(k text)
returns table(config jsonb, config_name text)
language sql
security definer
set search_path = public
stable
as $$
  select s.config, s.config_name
  from public.local_settings s
  where s.sync_key = k
    and k ~ '^[0-9a-f]{64}$';
$$;

-- 寫:給鑰匙,整份覆蓋。同一把鑰匙再寫就是更新,跟本機快取同一條規則。
create or replace function public.local_settings_put(k text, cfg jsonb, cfg_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if k !~ '^[0-9a-f]{64}$' then
    raise exception 'bad key';
  end if;
  insert into public.local_settings (sync_key, config, config_name, updated_at)
  values (k, cfg, cfg_name, now())
  on conflict (sync_key) do update
    set config = excluded.config,
        config_name = excluded.config_name,
        updated_at = now();
end;
$$;

revoke all on function public.local_settings_get(text) from public;
revoke all on function public.local_settings_put(text, jsonb, text) from public;
grant execute on function public.local_settings_get(text) to anon, authenticated;
grant execute on function public.local_settings_put(text, jsonb, text) to anon, authenticated;
