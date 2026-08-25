/* 用真的頁面驗證:同期 RTN+ADJ 的拆分與住/商判定,吃真的 8/22 帳單。 */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const fs = require("fs");

const vc = new VirtualConsole();
const pageErrors = [];
vc.on("jsdomError", e => pageErrors.push(String(e && e.message || e)));

let pass = 0, fail = 0;
const ck = (label, cond, extra) => {
  if (cond) { pass++; console.log("PASS ", label); }
  else { fail++; console.log("FAIL ", label, extra !== undefined ? JSON.stringify(extra) : ""); }
};

JSDOM.fromFile(path.join(__dirname, "index.html"), {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  virtualConsole: vc, url: "https://localhost/index.html",
}).then(dom => new Promise(res => {
  dom.window.addEventListener("load", () => setTimeout(() => res(dom), 800));
  setTimeout(() => res(dom), 6000);
})).then(dom => {
  const w = dom.window, d = w.document;
  for (const id of ["bTrkBreak", "trkSearch"]) ck("元素存在 #" + id, !!d.getElementById(id));

  const run = src => { const s = d.createElement("script"); s.textContent = src; d.body.appendChild(s); };
  run(`window.__t = {
    fn: typeof ingest, so: typeof shipmentsOf, ps: typeof priceShipment, sc: typeof scanCharges,
    cfgOn(){ if(!CFG) applyConfig(JSON.stringify(DEFAULT_CONFIG), "test"); return !!CFG; },
    hist(m){ HIST = m; },
    load(text){ window.__rows = ingest(text).rows; window.__ships = shipmentsOf(window.__rows); return window.__ships.length; },
    ship(t){ return window.__ships.find(s=>s.tracking===t) || null; },
    price(t){ const s=this.ship(t); if(!s) return null;
      const r=priceShipment(CFG, s);
      const out={ layer:s.layer, pureAdj:s.pureAdj, hasRtnSeg:!!s.rtnSeg,
        residential:r.residential, resBasis:r.resBasis, issues:r.issues,
        lpsNet:(scanCharges(s.lines, CFG.dynMap, CFG.accFuelOff).net["Large Package"]||0) };
      if(s.rtnSeg){ out.rtn={ residential:r.rtn?r.rtn.residential:null,
        resBasis:r.rtn?r.rtn.resBasis:null,
        lpsNet:(scanCharges(s.rtnSeg.lines, CFG.dynMap, CFG.accFuelOff).net["Large Package"]||0) }; }
      return out; },
    all(){ let n=0,e=0; for(const s of window.__ships){ try{ priceShipment(CFG,s); n++; }catch(x){ e++; console.log("EX",s.tracking,String(x)); } } return {n,e}; }
  };`);
  const T = w.__t;
  ck("ingest/shipmentsOf/priceShipment 是函式",
     T && T.fn === "function" && T.so === "function" && T.ps === "function",
     T && [T.fn, T.so, T.ps]);
  if (!T || T.fn !== "function") { console.log(pageErrors.slice(0, 5)); process.exit(1); }
  ck("設定載入", T.cfgOn());

  const csv = fs.readFileSync("/mnt/user-data/uploads/Invoice_000000174C7E346_082226.csv", "utf8");
  const nShips = T.load(csv);
  ck("8/22 分組數 > 0", nShips > 0, nShips);

  /* 無歷史狀態 */
  T.hist(null);

  /* 1) RTN only + 商業口味 LPS → com,依據=帳單商業代碼,不拆 */
  let r = T.price("1ZWX40940331111555");
  ck("555 不拆", r && !r.hasRtnSeg, r);
  ck("555 判商業", r && r.residential === false, r && r.resBasis);
  ck("555 依據=帳單商業代碼", r && /商業代碼|Commercial code/.test(r.resBasis), r && r.resBasis);

  /* 2) RTN+ADJ,SCC 說明含 Undeliverable Return(改回程)→ 不拆,整組 com,無查無歷史警告 */
  for (const t of ["1ZWX40940306399687", "1ZWX40940317922287"]) {
    r = T.price(t);
    ck(t.slice(-3) + " 不拆(SCC 改回程)", r && !r.hasRtnSeg, r);
    ck(t.slice(-3) + " 判商業", r && r.residential === false, r && r.resBasis);
    ck(t.slice(-3) + " 無歷史警告", r && !r.issues.some(m => /歷史|history|History/.test(m)), r && r.issues);
  }

  /* 3) RTN+ADJ,SCC 說明只寫 SCC Ground(改原出貨)→ 拆:
        主件= ADJ(pureAdj),LPR → 住宅;rtnSeg= 回程,LPS → 商業;LPS 兩桶分開 */
  r = T.price("1ZWX40940313567357");
  ck("357 拆出 rtnSeg", r && r.hasRtnSeg, r);
  ck("357 主件 pureAdj", r && r.pureAdj === true, r);
  ck("357 主件(ADJ)判住宅", r && r.residential === true, r && r.resBasis);
  ck("357 主件依據=帳單住宅代碼", r && /住宅代碼|Residential code/.test(r.resBasis), r && r.resBasis);
  ck("357 主件 LPS 桶 = -49.65(純沖銷)", r && Math.abs(r.lpsNet - (-49.65)) < 0.005, r && r.lpsNet);
  ck("357 回程判商業", r && r.rtn && r.rtn.residential === false, r && r.rtn);
  ck("357 回程 LPS 桶 = +42.90", r && r.rtn && Math.abs(r.rtn.lpsNet - 42.90) < 0.005, r && r.rtn && r.rtn.lpsNet);
  ck("357 無歷史警告(LPR 代碼定案)", r && !r.issues.some(m => /查不到|not in the history/.test(m)), r && r.issues);

  /* 4) 歷史說原出貨是住宅時,RTN 不再被翻案 */
  T.hist({ "1ZWX40940331111555": "R", "1ZWX40940306399687": "R" });
  r = T.price("1ZWX40940331111555");
  ck("555 有歷史(R)仍判商業(回程看自己)", r && r.residential === false, r && r.resBasis);
  r = T.price("1ZWX40940306399687");
  ck("687 有歷史(R)仍判商業(回程看自己)", r && r.residential === false, r && r.resBasis);
  T.hist(null);

  /* 5) 全帳單跑一輪不噴例外 */
  const a = T.all();
  ck("全部 " + a.n + " 筆計價無例外", a.e === 0, a);

  /* 6) 格式驗證:費率範本不是帳單,真帳單是 */
  run(`window.__t.llk = (txt)=>{ try{ return looksLikeInvoice(ingest(txt).rows); }catch(e){ return "EX:"+e.message; } };`);
  const tpl = "Shipment Type,Zone,Weight,Amount\nGround Commercial,8,105,12.5\nGround Residential,8,630,13.4\n";
  ck("費率範本 → 不是帳單", T.llk(tpl) === false, T.llk(tpl));
  ck("真 8/22 帳單 → 是帳單", T.llk(csv) === true, T.llk(csv));

  /* 7) breakdown 版型:分段卡 + 左右 UPS/Reprice + 合計條 */
  run(`window.__t.bkd=(t)=>{ const s=window.__ships.find(x=>x.tracking===t);
    if(!s) return null; const r=priceShipment(CFG,s); return bkdSection(r); };`);
  const html357 = T.bkd("1ZWX40940313567357") || "";
  ck("357 兩張分段卡", (html357.match(/class="bkdseg /g)||[]).length === 2,
     (html357.match(/class="bkdseg [a-z]+"/g)||[]));
  ck("357 一張 resi 一張 com",
     /class="bkdseg resi"/.test(html357) && /class="bkdseg com"/.test(html357));
  ck("357 每卡都有 UPS 與 Reprice 欄",
     (html357.match(/bkdside ups/g)||[]).length === 2 &&
     (html357.match(/bkdside rp/g)||[]).length === 2);
  ck("357 UPS 側含回程帳單行 42.90", /\$42\.90/.test(html357));
  ck("357 UPS 側含調整行 -49.65", /\$-49\.65|-\$49\.65/.test(html357),
     (html357.match(/\$-?[\d,]+\.\d\d/g)||[]).slice(0,12));
  ck("357 合計條存在", /class="bkdtot"/.test(html357));
  ck("357 燃油兩列各自百分比",
     (html357.match(/燃油 [\d.]+%|Fuel [\d.]+%/g)||[]).length === 2,
     (html357.match(/燃油 [\d.]+%|Fuel [\d.]+%/g)||[]));
  ck("357 無兩段註解文字", !/本筆為兩段|Two segments/.test(html357));
  run(`window.__t.open=(t)=>{ HISTROWS=window.__rows; document.getElementById("trkSearch").value=t;
    openBreakdown(); return document.getElementById("bkdBody").innerHTML; };`);
  const full357 = T.open("1ZWX40940313567357") || "";
  ck("追蹤號橫幅", /class="bkdtrk"/.test(full357));
  ck("期別色條", /class="bkdinv"/.test(full357), (full357.match(/bkdinv/g)||[]).length);
  ck("舊的細線分隔已移除", !/border-top:1px solid var\(--line\);margin:12px 0 8px/.test(full357));
  const html555 = T.bkd("1ZWX40940331111555") || "";
  ck("555 單段一張卡", (html555.match(/class="bkdseg /g)||[]).length === 1);
  ck("555 判商業卡", /class="bkdseg com"/.test(html555));

  /* 8) 未判定彙總 */
  run(`window.__t.agg=()=>{ RATED=window.__ships.map(s=>priceShipment(CFG,s));
    const d=dashAgg(); return d?{unsureN:d.unsureN, unsureAmt:d.unsureAmt,
      notRepriced:d.notRepriced, unknownNet:d.unknownNet, codes:d.unknownCodes}:null; };`);
  const A = T.agg();
  ck("dashAgg 回傳未判定欄位", A && typeof A.unsureN === "number", A);
  ck("未判定筆數 >= 0", A && A.unsureN >= 0, A && A.unsureN);
  ck("未知代碼是陣列", A && Array.isArray(A.codes), A && A.codes);

  /* 9) Dashboard 改版 */
  run(`window.__t.dash=()=>{ RATED=window.__ships.map(s=>priceShipment(CFG,s));
    ROWS=window.__rows; renderDashboard();
    return document.getElementById("dashBody").innerHTML; };`);
  const dash = T.dash() || "";
  ck("上排三格算式", (dash.match(/class="dcell/g)||[]).length === 3,
     (dash.match(/class="dcell[^"]*"/g)||[]));
  ck("有帳戶層費用格", /帳戶層費用|Account charges/.test(dash));
  ck("沒有 Profit / Margin 格", !/>Profit<|>Margin</.test(dash));
  ck("兩張甜甜圈區塊", (dash.match(/class="pie"/g)||[]).length === 2,
     (dash.match(/class="pie"/g)||[]).length);
  ck("渠道含 Unknown 切片", /未知|Unknown/.test(dash));
  ck("有渠道圖", /渠道|Channel/.test(dash));
  ck("Zone 長條保留", /class="zrow"/.test(dash));

  console.log("----------------------------------------");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (pageErrors.length) console.log("pageErrors:", pageErrors.slice(0, 3));
  process.exit(fail ? 1 : 0);
});
