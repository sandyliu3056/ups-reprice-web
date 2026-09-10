-- 兩個站分開存設定 —— 第 2 步,要在 Supabase 的 SQL Editor 跑一次
-- =====================================================================
-- 對帳站和 reprice 站共用同一個專案的 public.user_settings,而那張表
-- 一個帳號只有一列、config 只有一格,沒有任何欄位分得出是哪一站寫的。
-- 所以同一個帳號下,兩站會互相蓋掉對方的設定,下次登入又把對方那份
-- 當成自己的載回來。
--
-- 做法:一個站一組欄位。PostgREST 的 upsert 只會寫 payload 裡有的欄位
-- (ON CONFLICT DO UPDATE SET 只列出那幾欄),所以 reprice 存檔在資料庫
-- 層面就碰不到 config_recon,反過來也一樣 —— 不需要讀-改-寫,沒有競態。
--
-- 舊的 config / config_name 兩欄留著不動,當作凍結的過渡欄位:還在跑舊
-- 版程式的分頁只會寫那兩欄,新版讀不到,最壞的情況是「這次改的沒同步
-- 過去」,而不是把另一個站的設定整個抹掉。
--
-- 刻意不做資料搬移:那一列沒有任何欄位說得出是誰寫的,SQL 只能用猜的,
-- 而猜錯就是把一個站的設定永久掛到另一個站名下,還不會有任何錯誤訊息。
-- 搬移由各站自己在第一次讀取時做 —— 那時候它手上有本機快取和 __app
-- 這個戳記可以判斷。
--
-- 跑之前先看兩件事(兩段都應該有結果,而且不需要改):
--   select policyname,cmd,qual,with_check from pg_policies where tablename='user_settings';
--   select grantee,privilege_type,column_name
--     from information_schema.column_privileges where table_name='user_settings';
-- 現有的兩條 for all 政策會自動涵蓋新欄位,兩個 repo 也都沒有針對欄位
-- 授權,所以除了下面這一段之外沒有別的要改。
--
-- 這段可以重複跑,不會出事(add column if not exists)。
-- =====================================================================

alter table public.user_settings
  add column if not exists config_recon        jsonb,
  add column if not exists config_name_recon   text,
  add column if not exists updated_recon       timestamptz,
  add column if not exists config_reprice      jsonb,
  add column if not exists config_name_reprice text,
  add column if not exists updated_reprice     timestamptz;
