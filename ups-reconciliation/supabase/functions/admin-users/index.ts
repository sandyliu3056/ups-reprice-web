// 主帳號用的帳號管理。新增帳號需要 service_role 金鑰,那把金鑰絕對不能
// 進瀏覽器 —— 所以放在這裡,由 Supabase 代管。
//
// 每一次呼叫都先驗來人:必須帶著有效的登入 token,而且該帳號的
// app_metadata.role 要是 admin。驗不過就 403,不看 body 寫了什麼。
//
// 部署:
//   supabase functions deploy admin-users
// 環境變數 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動提供。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  // 前端送 apikey 一起過來,預檢就必須明著允許它 —— 少列一個,瀏覽器會擋在
  // preflight,而且只回「Failed to fetch」,看不出是哪個標頭被拒。
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  // ---- 來人是誰 ----
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
  if (!token) return reply({ error: "not signed in" }, 401);

  const asCaller = createClient(URL_, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return reply({ error: "not signed in" }, 401);
  if ((who.user.app_metadata as Record<string, unknown>)?.role !== "admin") {
    return reply({ error: "admins only" }, 403);
  }

  const admin = createClient(URL_, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return reply({ error: "bad request body" }, 400);
  }
  const action = String(body.action || "");
  // 登入用帳號,不是 email。Supabase 的密碼登入一定要一個 email,所以
  // 帳號補成 <帳號>@ups-reprice.invalid —— .invalid 是 RFC 2606 保留的,
  // 永遠解析不到,寄不出信,也不會誤寄給別人。真的 email 是選填的聯絡
  // 資訊,存在 user_metadata,不拿來當登入身分。
  const DOMAIN = "ups-reprice.invalid";
  const username = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const contactEmail = String(body.email || "").trim().toLowerCase();
  const email = username ? `${username}@${DOMAIN}` : "";
  const role = body.role === "admin" ? "admin" : "user";
  const userId = String(body.user_id || "");

  try {
    if (action === "list") {
      // 直接問 auth.users,不走 profiles。profiles 是觸發器同步的副本,
      // 在觸發器存在之前建立的帳號、或同步失敗過的帳號就不會在裡面 ——
      // 結果是「登得進去卻不在清單上」。能登入的人就該看得到,所以
      // 認證系統自己那份名單才是答案。
      const { data: list, error } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (error) throw error;
      const { data: cfgs } = await admin
        .from("user_settings")
        .select("user_id,config_name,updated_at");
      const byId = new Map((cfgs || []).map((c) => [c.user_id, c]));
      const users = (list?.users || []).map((u) => {
        const meta = (u.user_metadata || {}) as Record<string, string>;
        const authEmail = String(u.email || "").toLowerCase();
        const synthetic = authEmail.endsWith(`@${DOMAIN}`);
        return {
          id: u.id,
          username: meta.username || authEmail.split("@")[0],
          name: meta.display_name || meta.full_name || "",
          // 用真 email 開的舊帳號:那個 email 就是聯絡信箱,照樣顯示。
          contact_email: meta.contact_email || (synthetic ? "" : authEmail),
          role: (u.app_metadata as Record<string, unknown>)?.role === "admin"
            ? "admin"
            : "user",
          created_at: u.created_at,
          config_name: byId.get(u.id)?.config_name || "",
          config_at: byId.get(u.id)?.updated_at || "",
        };
      });
      users.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return reply({ users });
    }

    if (action === "create") {
      const password = String(body.password || "");
      if (!/^[a-z0-9._-]{2,}$/.test(username)) {
        return reply({ error: "username: at least 2 of a-z 0-9 . _ -" }, 400);
      }
      if (password.length < 8) {
        return reply({ error: "password must be at least 8 characters" }, 400);
      }
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,          // 主帳號開的帳號,不用再收信確認
        app_metadata: { role },
        user_metadata: {
          username,
          display_name: name || username,
          contact_email: contactEmail,
        },
      });
      if (error) {
        // Supabase 回的是 email 已存在,但使用者填的是帳號 —— 照他填的講。
        const m = /already/i.test(error.message)
          ? `username "${username}" is taken`
          : error.message;
        return reply({ error: m }, 400);
      }
      // 費率留空白,由該帳號自己匯入。這裡不建 user_settings 的列。
      return reply({ user: { id: data.user?.id, username, role } });
    }

    if (action === "update") {
      if (!userId) return reply({ error: "user_id required" }, 400);
      if (!/^[a-z0-9._-]{2,}$/.test(username)) {
        return reply({ error: "username: at least 2 of a-z 0-9 . _ -" }, 400);
      }
      const { data: cur, error: curErr } = await admin.auth.admin.getUserById(userId);
      if (curErr || !cur?.user) return reply({ error: "no such account" }, 400);
      const meta = (cur.user.user_metadata || {}) as Record<string, unknown>;
      const authEmail = String(cur.user.email || "").toLowerCase();
      const synthetic = authEmail.endsWith(`@${DOMAIN}`);
      // 角色與密碼不從這裡改 —— 各有專用的動作,混在一起容易誤觸。
      const patch: Record<string, unknown> = {
        user_metadata: {
          ...meta,
          username,
          display_name: name || username,
          contact_email: contactEmail,
        },
      };
      // 帳號就是登入身分。合成信箱的帳號改了帳號,登入信箱要跟著改,否則
      // 清單上寫著新帳號、實際能登入的還是舊的。
      // 用真 email 開的帳號不動它的登入信箱:那是本人登入用的東西,
      // 不是這個表格在管的欄位。
      if (synthetic && email && email !== authEmail) patch.email = email;
      const { error } = await admin.auth.admin.updateUserById(userId, patch);
      if (error) {
        const m = /already/i.test(error.message)
          ? `username "${username}" is taken`
          : error.message;
        return reply({ error: m }, 400);
      }
      await admin.from("profiles").update({
        username,
        name: name || username,
        contact_email: contactEmail,
        email: (patch.email as string) || authEmail,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      return reply({ ok: true, email_changed: !!patch.email });
    }

    if (action === "set_role") {
      if (!userId) return reply({ error: "user_id required" }, 400);
      if (userId === who.user.id && role !== "admin") {
        // 把自己降級會讓這個專案沒有人管得動,而且是從畫面上按一下就發生。
        return reply({ error: "cannot remove your own admin role" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: { role },
      });
      if (error) throw error;
      await admin.from("profiles").update({ role, updated_at: new Date().toISOString() })
        .eq("id", userId);
      return reply({ ok: true });
    }

    if (action === "set_password") {
      const password = String(body.password || "");
      if (!userId || password.length < 8) {
        return reply({ error: "user_id required, password at least 8 characters" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      return reply({ ok: true });
    }

    if (action === "delete") {
      if (!userId) return reply({ error: "user_id required" }, 400);
      if (userId === who.user.id) {
        return reply({ error: "cannot delete your own account" }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return reply({ ok: true });
    }

    return reply({ error: "unknown action" }, 400);
  } catch (e) {
    return reply({ error: (e as Error).message || "failed" }, 400);
  }
});
