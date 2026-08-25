/* 真頁面驗證燃油排程篩選:渠道圓片多選、日期區間、✕ 清除、刪除索引不位移。 */
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

  for (const id of ["fuelFChans", "fuelFFrom", "fuelFTo", "bFuelFClear", "fuelFCount", "tFuel"])
    ck("元素存在 #" + id, !!d.getElementById(id));

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
    rows(){ return [...document.querySelectorAll("#tFuel tbody tr")]
      .filter(t=>!t.querySelector(".empty")).length; },
    chips(){ return [...document.querySelectorAll("#fuelFChans .fchip")].map(c=>c.dataset.ch); },
    click(ch){ [...document.querySelectorAll("#fuelFChans .fchip")]
      .find(c=>c.dataset.ch===ch).click(); },
    date(f,t){ const a=document.getElementById("fuelFFrom"), b=document.getElementById("fuelFTo");
      a.value=f; a.dispatchEvent(new Event("blur"));
      b.value=t; b.dispatchEvent(new Event("blur")); },
    clear(){ document.getElementById("bFuelFClear").click(); },
    count(){ return document.getElementById("fuelFCount").textContent; },
    di(){ return [...document.querySelectorAll(".fuelrow")]
      .map(c=>c.dataset.ch+"#"+c.dataset.i); }
  };`);
  const F = w.__f;
  ck("測試掛鉤就緒", !!F);
  F.seed();
  ck("初始 4 列", F.rows() === 4, F.rows());
  ck("兩個渠道圓片", F.chips().length === 2, F.chips());

  // 渠道多選
  F.click("Ground Residential");
  ck("單選渠道 → 3 列", F.rows() === 3, F.rows());
  F.click("Ground Commercial");
  ck("多選兩渠道 → 4 列", F.rows() === 4, F.rows());
  ck("計數顯示 4 / 4", F.count() === "4 / 4", F.count());
  F.click("Ground Residential"); F.click("Ground Commercial");
  ck("取消後回全部且不顯示計數", F.rows() === 4 && F.count() === "", F.count());

  // 日期區間(交集):8/1~8/5 蓋到 7/27–8/2、兩條 8/3–8/9 → 3 列
  F.date("2026-08-01", "2026-08-05");
  ck("日期篩選 → 3 列", F.rows() === 3, F.rows());
  ck("計數 3 / 4", F.count() === "3 / 4", F.count());

  // 渠道 + 日期並用
  F.click("Ground Commercial");
  ck("渠道+日期 → 1 列", F.rows() === 1, F.rows());
  // 刪除索引仍為原始索引(GC 唯一那條 i=0)
  ck("data-i 保持原始索引", F.di().join() === "Ground Commercial#0", F.di().join());

  // 手打各種格式
  F.clear();
  F.date("2026/8/3", "20260809");
  ck("混格式日期也吃 → 2 列", F.rows() === 2, F.rows());

  // 清除
  F.clear();
  ck("✕ 清除 → 4 列、無計數", F.rows() === 4 && F.count() === "", F.rows() + "|" + F.count());

  // 篩到零列時的空訊息
  F.date("2030-01-01", "2030-01-02");
  const tb = d.querySelector("#tFuel tbody").textContent;
  ck("零列顯示『沒有符合篩選』", /沒有符合篩選|No ranges match/.test(tb));
  F.clear();

  const scriptErrs = errs.filter(e => !/resource|Could not load|ENOENT|css|canvas|getContext/i.test(e));
  ck("頁面無腳本錯誤", scriptErrs.length === 0, scriptErrs.slice(0, 3).join(" | "));
  console.log(`\n${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error("HARNESS FAIL", e); process.exit(2); });
