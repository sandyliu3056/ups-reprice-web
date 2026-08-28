// UPS 地址驗證代理(住宅／商業判定)。
// 瀏覽器不能直接打 UPS —— 要 OAuth 金鑰,還會被 CORS 擋 —— 所以金鑰放這裡,
// 由 Supabase 代管,前端只丟地址進來,拿回 R / C / U(住宅 / 商業 / 判不出)。
//
// 前端呼叫(index.html 的 prefetchAddressClass):
//   POST { name, address, city, state, postal, country }
//   -> { class: "R" | "C" | "U", description }
//
// 需要的環境變數(supabase secrets set ...):
//   UPS_CLIENT_ID       UPS 開發者應用程式的 Client ID
//   UPS_CLIENT_SECRET   UPS 開發者應用程式的 Client Secret
//   UPS_BASE            選填,預設正式環境 https://onlinetools.ups.com
//                       測試環境填 https://wwwcie.ups.com
// SUPABASE_URL / SUPABASE_ANON_KEY 由平台自動提供。
//
// 部署:
//   supabase functions deploy ups-address
//   supabase secrets set UPS_CLIENT_ID=... UPS_CLIENT_SECRET=...
// 部署後把函式網址填進「帳單歷史」頁的 API 端點欄:
//   https://<專案>.supabase.co/functions/v1/ups-address

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const UPS_ID = Deno.env.get("UPS_CLIENT_ID") || "";
const UPS_SECRET = Deno.env.get("UPS_CLIENT_SECRET") || "";
const UPS_BASE = (Deno.env.get("UPS_BASE") || "https://onlinetools.ups.com").replace(/\/+$/, "");

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

// UPS OAuth token 存在模組層,重複用到快過期為止 —— Edge Function 常常是熱的,
// 每一個地址都重新換 token 會很慢也容易撞 UPS 的速率限制。
let TOKEN = "";
let TOKEN_EXP = 0;
async function upsToken(): Promise<string> {
  const now = Date.now();
  if (TOKEN && now < TOKEN_EXP - 60_000) return TOKEN;
  const basic = btoa(`${UPS_ID}:${UPS_SECRET}`);
  const res = await fetch(`${UPS_BASE}/security/v1/oauth/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`UPS auth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  TOKEN = String(j.access_token || "");
  TOKEN_EXP = now + (Number(j.expires_in || 3600) * 1000);
  if (!TOKEN) throw new Error("UPS auth: no access_token");
  return TOKEN;
}

// AddressClassification.Code: 0 = UnClassified, 1 = Commercial, 2 = Residential
function codeToClass(code: unknown): "R" | "C" | "U" {
  const c = String(code ?? "").trim();
  return c === "2" ? "R" : c === "1" ? "C" : "U";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  // ---- 只讓登入的人用,別把 UPS 額度開給全世界 ----
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
  if (!token) return reply({ error: "not signed in" }, 401);
  const asCaller = createClient(SUPA_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return reply({ error: "not signed in" }, 401);

  if (!UPS_ID || !UPS_SECRET) return reply({ error: "UPS credentials not configured" }, 500);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return reply({ error: "bad request body" }, 400);
  }
  const address = String(body.address || "").trim();
  const city = String(body.city || "").trim();
  const state = String(body.state || "").trim();
  const postal = String(body.postal || "").trim().slice(0, 5);
  const country = String(body.country || "US").trim() || "US";
  const name = String(body.name || "").trim();
  if (!address && !postal) return reply({ error: "address or postal required" }, 400);

  try {
    const tok = await upsToken();
    // requestoption 3 = Address Validation + Address Classification
    const url = `${UPS_BASE}/api/addressvalidation/v2/3`;
    const payload = {
      XAVRequest: {
        AddressKeyFormat: {
          ConsigneeName: name || undefined,
          AddressLine: address ? [address] : undefined,
          PoliticalDivision2: city || undefined, // City
          PoliticalDivision1: state || undefined, // State
          PostcodePrimaryLow: postal || undefined,
          CountryCode: country,
        },
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tok}`,
        "Content-Type": "application/json",
        "transId": crypto.randomUUID(),
        "transactionSrc": "ups-reprice",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return reply({ error: `UPS ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
    }
    const j = await res.json();
    const xav = j?.XAVResponse || {};
    // 分類可能在最外層,也可能落在第一個候選地址上。
    const cand = Array.isArray(xav.Candidate) ? xav.Candidate[0] : xav.Candidate;
    const cls = xav.AddressClassification || (cand && cand.AddressClassification) || {};
    const klass = codeToClass(cls.Code);
    return reply({ class: klass, description: String(cls.Description || "") });
  } catch (e) {
    return reply({ error: (e as Error).message || "failed" }, 502);
  }
});
