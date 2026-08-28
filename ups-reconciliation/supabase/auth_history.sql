-- =====================================================================
-- 登入帳號模式的帳單歷史雲端同步
-- ---------------------------------------------------------------------
-- 本機帳號模式的同步鑰匙是「帳號+密碼」推出來的一串 64 位十六進位碼,由
-- 瀏覽器算好、當參數送上來(local_history_* 那四個函式)。Supabase 登入
-- 模式沒有密碼可以推,所以那條路整段被關掉 —— 費率還會同步,帳單歷史
-- 卻只留在各自的電腦上。多台電腦輪流用的時候,那是個大洞。
--
-- 這裡補上另一組函式。差別只有一個,但那個差別很重要:
--   鑰匙不是呼叫端給的,是資料庫自己從登入身分取的(auth.uid())。
--   所以「拿到別人的鑰匙就能讀別人的帳單」這件事不存在 —— 沒有鑰匙這個
--   東西可以拿。沒登入就直接擋掉。
--
-- 用的是同一張 local_history 表,鑰匙前面加 'uid:' 和本機模式那批分開,
-- 兩種模式的資料不會互相看到,也不會撞在一起。
--
-- 在 Supabase 後台 → SQL Editor 貼上執行一次即可。重複執行是安全的。
-- =====================================================================

create or replace function public.hist_list()
returns table(invoice text, meta jsonb)
language plpgsql security definer set search_path = public stable
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return query
    select h.invoice, h.meta from public.local_history h
    where h.sync_key = 'uid:'||auth.uid()::text;
end;
$$;

create or replace function public.hist_get(inv text)
returns table(meta jsonb, data text)
language plpgsql security definer set search_path = public stable
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return query
    select h.meta, h.data from public.local_history h
    where h.sync_key = 'uid:'||auth.uid()::text and h.invoice = inv;
end;
$$;

create or replace function public.hist_put(inv text, m jsonb, d text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if inv is null or length(inv) = 0 or length(inv) > 64 then
    raise exception 'bad invoice key';
  end if;
  insert into public.local_history (sync_key, invoice, meta, data, updated_at)
  values ('uid:'||auth.uid()::text, inv, m, d, now())
  on conflict (sync_key, invoice) do update
    set meta = excluded.meta, data = excluded.data, updated_at = now();
end;
$$;

create or replace function public.hist_del(inv text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.local_history h
  where h.sync_key = 'uid:'||auth.uid()::text and h.invoice = inv;
end;
$$;

-- 只有登入過的人叫得動。anon 連呼叫都不行 —— 這四個函式對未登入的呼叫
-- 沒有任何意義,不必留著讓人試。
revoke all on function public.hist_list()                 from public;
revoke all on function public.hist_get(text)              from public;
revoke all on function public.hist_put(text, jsonb, text) from public;
revoke all on function public.hist_del(text)              from public;
grant execute on function public.hist_list()                 to authenticated;
grant execute on function public.hist_get(text)              to authenticated;
grant execute on function public.hist_put(text, jsonb, text) to authenticated;
grant execute on function public.hist_del(text)              to authenticated;
