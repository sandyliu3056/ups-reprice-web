/* 真頁面驗證:燃油排程渠道下拉篩選 + Breakdown 視窗放大縮小。 */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const vc = new VirtualConsole();
const errs = [];
vc.on("jsdomError", e => errs.push(String(e && e.message || e)));
let pass = 0, fail = 0;
const ck = (l, c, x) => { if (c) { pass++; console.log("PASS ", l); }
  else { fail++; console.log("FAIL ", l, x || ""); } };

JSDOM.fromFile(path.join(__dirname, "index.html"), {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  virtualConsole: vc, url: "https://localhost/index.html",
}).then(dom => new Promise(res => {
  dom.window.addEventListener("load", () => setTimeout(() => res(dom), 800));
  setTimeout(() => res(dom), 6000);
})).then(dom => {
  const w = dom.window, d = w.document;
  const run = src => { const s = d.createElement("script"); s.textContent = src; d.body.appendChild(s); };

  for (const id of ["fuelFChan", "fuelFCount", "tFuel", "bkdMax", "bkdModal"])
    ck("元素存在 #" + id, !!d.getElementById(id));
  ck("舊的日期篩選欄位已移除", !d.getElementById("fuelFFrom") && !d.getElementById("bFuelFClear"));

  run(`window.__f = {
    seed(){
      if(!CFG) applyConfig(JSON.stringify(DEFAULT_CONFIG),"t");
      CFG.raw.channel_fuel_schedules = {
        "Ground Residential":[
          {start:"2026-07-20",end:"2026-07-26",pct:22.125},
          {start:"2026-07-27",end:"2026-08-02",pct:23.625},
          {start:"2026-08-03",end:"2026-08-09",pct:24.075}],
        "Ground Commercial":[
          {start:"2026-08-03",end:"2026-08-09",pct:21.5}]
      };
      CFG = readConfig(CFG.raw);
      openFuel();
    },
    chanCount(){ return Object.keys(CFG.raw.builtin_service_zones||{}).length; },
    opts(){ return [...document.getElementById("fuelFChan").options].map(o=>o.value); },
    pick(v){ const s=document.getElementById("fuelFChan"); s.value=v;
      s.dispatchEvent(new Event("change")); },
    rows(){ return [...document.querySelectorAll("#tFuel tbody tr")]
      .filter(t=>!t.querySelector(".empty")).length; },
    count(){ return document.getElementById("fuelFCount").textContent; },
    di(){ return [...document.querySelectorAll(".fuelrow")]
      .map(c=>c.dataset.ch+"#"+c.dataset.i).join(); },
    tb(){ return document.querySelector("#tFuel tbody").textContent; }
  };`);
  const F = w.__f;
  ck("測試掛鉤就緒", !!F);
  F.seed();

  // 下拉 = 全部渠道 + 「全部」
  ck("下拉列出設定裡全部渠道", F.opts().length === F.chanCount() + 1,
    F.opts().length + " vs " + (F.chanCount() + 1));
  ck("含沒有排程的渠道(SurePost)", F.opts().includes("SurePost"), F.opts().join());
  ck("初始 4 列、無計數", F.rows() === 4 && F.count() === "");

  F.pick("Ground Residential");
  ck("選 GR → 3 列、計數 3 / 4", F.rows() === 3 && F.count() === "3 / 4",
    F.rows() + "|" + F.count());
  F.pick("Ground Commercial");
  ck("選 GC → 1 列且 data-i 為原始索引", F.rows() === 1 && F.di() === "Ground Commercial#0",
    F.di());
  F.pick("SurePost");
  ck("無排程渠道 → 空訊息", F.rows() === 0 && /這個渠道沒有區間|No ranges for this channel/.test(F.tb()));
  F.pick("");
  ck("回全部 → 4 列、無計數", F.rows() === 4 && F.count() === "");

  // Breakdown 視窗放大縮小
  run(`window.__m = {
    on(){ return document.getElementById("bkdModal").classList.contains("max"); },
    glyph(){ return document.getElementById("bkdMax").textContent; },
    click(){ document.getElementById("bkdMax").click(); },
    bodyCapped(){ return /max-height/.test(document.getElementById("bkdBody").getAttribute("style")||""); }
  };`);
  const M = w.__m;
  ck("bkdBody 不再被 72vh 卡住", !M.bodyCapped());
  ck("初始為 ⤢ 未放大", !M.on() && M.glyph() === "⤢", M.glyph());
  M.click();
  ck("按一下 → 放大、⤡", M.on() && M.glyph() === "⤡", M.glyph());
  M.click();
  ck("再按 → 還原、⤢", !M.on() && M.glyph() === "⤢", M.glyph());

  const scriptErrs = errs.filter(e => !/resource|Could not load|ENOENT|css|canvas|getContext/i.test(e));
  ck("頁面無腳本錯誤", scriptErrs.length === 0, scriptErrs.slice(0, 3).join(" | "));
  console.log(`\n${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error("HARNESS FAIL", e); process.exit(2); });
