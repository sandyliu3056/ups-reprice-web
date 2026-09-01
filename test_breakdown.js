/* 用真的頁面驗證 openBreakdown 改版:載入 index.html、注入假 HISTROWS、逐案檢查。 */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");

const vc = new VirtualConsole();
const pageErrors = [];
vc.on("jsdomError", e => pageErrors.push(String(e && e.message || e)));
vc.on("error", (...a) => pageErrors.push(a.join(" ")));

let pass = 0, fail = 0;
const ck = (label, cond, extra) => {
  if (cond) { pass++; console.log("PASS ", label); }
  else { fail++; console.log("FAIL ", label, extra || ""); }
};

JSDOM.fromFile(path.join(__dirname, "index.html"), {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: "https://localhost/index.html",
}).then(dom => new Promise(res => {
  dom.window.addEventListener("load", () => setTimeout(() => res(dom), 800));
  setTimeout(() => res(dom), 6000); // 保底
})).then(dom => {
  const w = dom.window, d = w.document;

  // 真頁面基本件
  for (const id of ["bTrkBreak", "bkdBody", "bkdBg", "trkSearch"])
    ck("元素存在 #" + id, !!d.getElementById(id));

  // 語法錯誤 = 這裡就會少函式
  const run = src => {
    const s = d.createElement("script");
    s.textContent = src;
    d.body.appendChild(s);
  };
  run(`window.__t = {
    fn: typeof openBreakdown, sec: typeof bkdSection,
    setup(rows){ HISTROWS = rows; },
    cfgOn(){ if(!CFG) applyConfig(JSON.stringify(DEFAULT_CONFIG), "test"); return !!CFG; },
    acct(){ return Array.isArray(ACCT_LINES) ? ACCT_LINES.length : -1; },
    poke(v){ document.getElementById("trkSearch").value = v; openBreakdown(); }
  };`);
  const T = w.__t;
  ck("openBreakdown 是函式", T && T.fn === "function", T && T.fn);
  ck("bkdSection 是函式", T && T.sec === "function", T && T.sec);
  if (!T || T.fn !== "function") { console.log(pageErrors.slice(0, 5)); process.exit(1); }

  const body = () => d.getElementById("bkdBody").innerHTML;

  // 案 1:沒輸入單號
  T.poke("");
  ck("空單號提示", /先在上面輸入單號|Enter a tracking/.test(body()));

  // 案 2:已存帳單裡沒有
  T.setup([]);
  T.poke("NOSUCHTRK");
  ck("查無提示", /已存帳單裡沒有|not in any stored invoice/.test(body()));

  // 案 3:兩期都有 → 各期比對表 + 兩段明細
  ck("設定檔就緒", T.cfgOn());
  const row = o => Object.assign({
    ai: "SHP", idx: 1, invoice: "", invDate: "", shipDate: "2026-07-27",
    tracking: "TESTTRK0001", lead: "", layer: "SHP", cls: "SHP",
    code: "003", detail: "TP", desc: "Ground Residential Third Party",
    zone: "8", entered: 61, billed: 90, declaredValue: 0, bwt: "",
    dimsC: "", dimsA: "", ref1: "", ref2: "", note: "", net: 20.5,
  }, o);
  const before = T.acct();
  T.setup([
    row({ invoice: "INVA001", invDate: "2026-08-01" }),
    row({ invoice: "INVA001", invDate: "2026-08-01", code: "FSC", desc: "Fuel Surcharge", entered: 0, billed: 0, net: 3.1 }),
    row({ invoice: "INVB002", invDate: "2026/8/22", layer: "RTN", cls: "RTN", detail: "RTS", code: "3", desc: "Ground Undeliverable Return", entered: 0, billed: 90, net: 18.0 }),
  ]);
  T.poke("TESTTRK0001");
  const h = body();
  ck("有各期比對表", /各期比對|Per-invoice comparison/.test(h));
  ck("列出 INVA001", h.includes("INVA001"));
  ck("列出 INVB002", h.includes("INVB002"));
  ck("列出兩個帳單日期", h.includes("2026-08-01") && h.includes("2026/8/22"));
  ck("UPS 實收欄有金額", /\$23\.60/.test(h) && /\$18\.00/.test(h));
  ck("每列有 Margin 欄", /Margin|毛利率/.test(h));
  ck("有逐期明細(UPS 帳單/退件回程)", /(UPS 帳單|UPS billed)/.test(h) && /(退件回程|Return leg)/.test(h));
  ck("UPS 段有米紋底樣式", /bkdblk bkd-ups/.test(h));
  ck("Reprice 段有金邊樣式", /bkdblk bkd-rp/.test(h));
  ck("Total 金底列", /background:var\(--select\)/.test(h));
  ck("差異列有正負色", /color:(var\(--neg\)|#2f7d32)/.test(h));
  ck("大標題 21px", /font-size:21px/.test(h));
  ck("期別中標題 16px", /font-size:16px/.test(h));
  ck("ACCT_LINES 有存有還", T.acct() === before, T.acct() + " vs " + before);

  // 頁面載入不得有腳本錯誤(資源 404 類先濾掉)
  const scriptErrs = pageErrors.filter(e => !/resource|Could not load|ENOENT|css/i.test(e));
  ck("頁面無腳本錯誤", scriptErrs.length === 0, scriptErrs.slice(0, 3).join(" | "));

  console.log(`\n${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error("HARNESS FAIL", e); process.exit(2); });
