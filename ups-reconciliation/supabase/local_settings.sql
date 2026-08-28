-- UPS Reprice — 本機帳號模式的設定同步
-- 在 Supabase 後台 SQL Editor 整份貼上執行一次。可重複執行。
--
-- 背景:網站目前用本機帳號登入(index.html 的 LOCAL_MODE),沒有 Supabase
-- 登入身分可用。設定要跨電腦跟著帳號走,所以另外開一張表:
--
--   local_settings   一把「同步鑰匙」一列,裝那把鑰匙對應的設定
--
-- 鑰匙是瀏覽器在登入當下用 PBKDF2 算的:
--   PBKDF2(密碼, 鹽 = "ups-reprice::" + 帳號, 600000 輪, SHA-256) → 64 位十六進位
-- 不知道密碼就算不出鑰匙;repo 裡公開的登入雜湊是另一種算法,推不出這把。
-- 以前是 sha256 跑一輪:一台普通機器一秒可以算幾億次,知道帳號的人拿一本
-- 常見密碼字典就能把鑰匙一個一個試出來,而且這裡沒有次數上限。PBKDF2 跑
-- 六十萬輪,一次推導約十分之一秒,同一本字典要試完的時間差好幾個數量級;
-- 鹽用帳號本身,攻擊者就不能算一本通用對照表拿去對所有人。
-- 舊鑰匙底下的資料由前端在登入時自動搬到新鑰匙(index.html 的 syncMigrate)。
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

-- ------------------------------------------------------------ 帳單歷史同步
-- 跟 local_settings 同一套置物櫃設計:同一把鑰匙,一期帳單一列。
-- data 是瀏覽器 gzip 後轉 base64 的明細(通常只剩原本的十分之一),
-- meta 記期別資訊(日期、列數、歸檔時間、z=是否壓縮)。

create table if not exists public.local_history (
  sync_key   text not null,
  invoice    text not null,
  meta       jsonb,
  data       text,
  updated_at timestamptz not null default now(),
  primary key (sync_key, invoice)
);

alter table public.local_history enable row level security;
revoke all on table public.local_history from anon, authenticated;

-- 列出這把鑰匙存過哪幾期(只回期號與 meta,不回明細,清單才輕)。
create or replace function public.local_history_list(k text)
returns table(invoice text, meta jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select h.invoice, h.meta
  from public.local_history h
  where h.sync_key = k
    and k ~ '^[0-9a-f]{64}$';
$$;

-- 抓某一期的明細。
create or replace function public.local_history_get(k text, inv text)
returns table(meta jsonb, data text)
language sql
security definer
set search_path = public
stable
as $$
  select h.meta, h.data
  from public.local_history h
  where h.sync_key = k
    and h.invoice = inv
    and k ~ '^[0-9a-f]{64}$';
$$;

-- 寫入一期。同期再寫就整期覆蓋,跟本機 IndexedDB 同一條規則。
create or replace function public.local_history_put(k text, inv text, m jsonb, d text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if k !~ '^[0-9a-f]{64}$' then
    raise exception 'bad key';
  end if;
  if inv is null or length(inv) = 0 or length(inv) > 64 then
    raise exception 'bad invoice';
  end if;
  insert into public.local_history (sync_key, invoice, meta, data, updated_at)
  values (k, inv, m, d, now())
  on conflict (sync_key, invoice) do update
    set meta = excluded.meta,
        data = excluded.data,
        updated_at = now();
end;
$$;

-- 刪除一期。本人在「已存的帳單」視窗勾選刪除時呼叫,同一把鑰匙才刪得掉。
create or replace function public.local_history_del(k text, inv text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if k !~ '^[0-9a-f]{64}$' then
    raise exception 'bad key';
  end if;
  delete from public.local_history h
   where h.sync_key = k and h.invoice = inv;
end;
$$;

revoke all on function public.local_history_list(text) from public;
revoke all on function public.local_history_get(text, text) from public;
revoke all on function public.local_history_put(text, text, jsonb, text) from public;
revoke all on function public.local_history_del(text, text) from public;
grant execute on function public.local_history_list(text) to anon, authenticated;
grant execute on function public.local_history_get(text, text) to anon, authenticated;
grant execute on function public.local_history_put(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.local_history_del(text, text) to anon, authenticated;
