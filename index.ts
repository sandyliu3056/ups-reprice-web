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
  "Access-Control-Allow-Headers": "authorization, content-type",
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
      // profiles 是觸發器同步過來的,一次拿得到 email 與角色;
      // 費率有沒有設定則看 user_settings 有沒有那一列。
      const { data: rows, error } = await admin
        .from("profiles")
        .select("id,email,username,name,contact_email,role,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const { data: cfgs } = await admin
        .from("user_settings")
        .select("user_id,config_name,updated_at");
      const byId = new Map((cfgs || []).map((c) => [c.user_id, c]));
      return reply({
        users: (rows || []).map((r) => ({
          ...r,
          // 舊帳號(用真 email 開的)沒有 username 欄位,拿 email 的前段頂著。
          username: r.username || String(r.email || "").split("@")[0],
          config_name: byId.get(r.id)?.config_name || "",
          config_at: byId.get(r.id)?.updated_at || "",
        })),
      });
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
