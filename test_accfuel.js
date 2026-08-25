/* 真頁面驗證「每種附加費是否吃燃油」的設定:
   預設全開、關掉會寫進設定、開回來要清乾淨、以及真的影響燃油金額。 */
const { JSDOM, VirtualConsole } = require("jsdom");
const path = require("path");
const vc = new VirtualConsole();
const errs = [];
vc.on("jsdomError", e => errs.push(String(e && e.message || e)));
let pass = 0, fail = 0;
const ck = (l, c, x) => { if (c) { pass++; console.log("PASS ", l); }
  else { fail++; console.log("FAIL ", l, x === undefined ? "" : x); } };

JSDOM.fromFile(path.join(__dirname, "index.html"), {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
  virtualConsole: vc, url: "https://localhost/index.html",
}).then(dom => new Promise(res => {
  dom.window.addEventListener("load", () => setTimeout(() => res(dom), 800));
  setTimeout(() => res(dom), 6000);
})).then(dom => {
  const w = dom.window, d = w.document;
  const run = src => { const s = d.createElement("script"); s.textContent = src; d.body.appendChild(s); };

  run(`window.__t = {
    seed(){
      if(!CFG) applyConfig(JSON.stringify(DEFAULT_CONFIG),"t");
      /* 退回寄件人給一個看得出來的費率,燃油給一個好算的 20% */
      CFG.raw.accessorial_rate_table["Return To Sender|||Ground Residential"]=18;
      /* 另一項保持開啟,用來證明只有被關掉的那一項被排除 */
      CFG.raw.accessorial_rate_table["Residential Surcharge|||Ground Residential"]=5;
      CFG.raw.global_rules.fuel_percent="20";
      CFG.raw.channel_fuel_schedules={};
      CFG.raw.fuel_schedule=[];
      CFG=readConfig(CFG.raw);
      renderConfigTabs();
    },
    /* 一列 250 欄的帳單行,組成沒有標題列的 CSV —— 和 UPS 下載回來的一樣 */
    row(o){
      const r=new Array(250).fill("");
      r[4]="2026-04-28"; r[5]="TESTINV"; r[11]=o.date||"2026-04-28";
      r[20]=o.tracking||"1ZTEST0000000001"; r[33]="008";
      r[26]="5.0"; r[28]="5.0";
      r[34]=o.layer||"SHP"; r[35]=o.detail||"";
      r[43]=o.ar; r[44]=o.as; r[45]=o.desc||""; r[52]=String(o.net);
      return r.join(",");
    },
    csv(){
      return [
        this.row({ar:"FRT",as:"003",desc:"Ground Residential",net:10.00}),
        this.row({ar:"ACC",as:"ISW",desc:"Return To Sender - Web Request",net:18.00}),
        this.row({ar:"ACC",as:"RES",desc:"Residential Surcharge",net:5.00}),
      ].join("\\n");
    },
    ship(){ return shipmentsOf(ingest(this.csv()).rows)[0]; },
    price(){
      const r=priceShipment(CFG,this.ship());
      return {fuel:r.fuel, rts:(r.acc&&r.acc["Return To Sender"])||0,
              res:(r.acc&&r.acc["Residential Surcharge"])||0};
    },
    scan(){
      return [...scanCharges(this.ship().lines, CFG.dynMap, CFG.accFuelOff).nonFuel];
    },
    open(){ document.getElementById("bAccFuel").click(); },
    shown(){ return document.getElementById("afBg").classList.contains("on"); },
    close(){ document.getElementById("afClose").click(); },
    boxes(){ return [...document.querySelectorAll("#afList input.accfuel")]; },
    box(fee){ return this.boxes().find(b=>b.dataset.fee===fee); },
    toggle(fee,on){ const b=this.box(fee); b.checked=on; b.onchange(); },
    all(){ document.getElementById("bAfAll").click(); },
    none(){ document.getElementById("bAfNone").click(); },
    count(){ return document.getElementById("afCount").textContent; },
    summary(){ return document.getElementById("accFuelSum").textContent; },
    cfgKey(){ return JSON.stringify(CFG.raw.accessorial_fuel_eligible||{}); },
    off(){ return [...(CFG.accFuelOff||[])]; }
  };`);

  const T = w.__t;
  if(!T) console.error("注入失敗:", errs.slice(0,5).join("\n---\n"));
  ck("測試掛鉤就緒", !!T);
  T.seed();

  /* ---- 小視窗:Settings 頁按鈕開得起來 ---- */
  ck("一開始小視窗是關的", T.shown() === false);
  ck("Settings 頁按鈕存在", !!d.getElementById("bAccFuel"));
  T.open();
  ck("按下去小視窗打開", T.shown() === true);

  /* ---- 預設 ---- */
  const boxes = T.boxes();
  ck("小視窗列出附加費項目", boxes.length > 0, boxes.length);
  ck("清單含 Return To Sender", !!T.box("Return To Sender"));
  ck("清單含還沒填費率的 AHS Weight", !!T.box("AHS Weight"));
  ck("預設每一格都是勾的（都吃燃油）", boxes.every(b => b.checked),
     boxes.filter(b => !b.checked).map(b => b.dataset.fee).join());
  ck("預設設定檔那一格是空的", T.cfgKey() === "{}", T.cfgKey());
  ck("預設沒有任何項目被排除", T.off().length === 0, T.off().join());
  ck("預設 Return To Sender 有進燃油底", T.scan().indexOf("Return To Sender") < 0, T.scan().join());

  /* 這份設定沒有基本運費表,所以合約底價是 0,燃油底就只有附加費 —— 
     18(退回寄件人) + 5(住宅費)。 */
  const on = T.price();
  ck("預設:退回寄件人收 18", Math.abs(on.rts - 18) < 0.005, on.rts);
  ck("預設:住宅費收 5", Math.abs(on.res - 5) < 0.005, on.res);
  ck("預設:燃油含兩項 → (18+5)x20% = 4.60", Math.abs(on.fuel - 4.60) < 0.005, on.fuel);

  /* ---- 關掉 ---- */
  T.toggle("Return To Sender", false);
  ck("關掉後寫進設定", T.cfgKey() === '{"Return To Sender":false}', T.cfgKey());
  ck("關掉後 accFuelOff 有它", T.off().join() === "Return To Sender", T.off().join());
  ck("關掉後 scanCharges 把它列入不計燃油",
     T.scan().indexOf("Return To Sender") >= 0, T.scan().join());
  ck("關掉後畫面那一格變成未勾", T.box("Return To Sender").checked === false);
  ck("關掉後那一列標成刪除線",
     T.box("Return To Sender").parentElement.className.indexOf("off") >= 0,
     T.box("Return To Sender").parentElement.className);
  ck("小視窗計數扣掉關掉的那一項", T.count() === "26 / 27", T.count());
  ck("Settings 頁摘要列出被關的項目",
     /Return To Sender/.test(T.summary()), T.summary());

  const off = T.price();
  ck("關掉後:退回寄件人仍然收 18(費用本身照收)", Math.abs(off.rts - 18) < 0.005, off.rts);
  ck("關掉後:住宅費不受影響,仍是 5", Math.abs(off.res - 5) < 0.005, off.res);
  ck("關掉後:燃油只剩住宅費 → 5x20% = 1.00", Math.abs(off.fuel - 1.00) < 0.005, off.fuel);

  /* ---- 其他項目不受影響 ---- */
  ck("只影響被關的那一項",
     T.scan().filter(x => x !== "Return To Sender").length === 0, T.scan().join());

  /* ---- 開回來要清乾淨 ---- */
  T.toggle("Return To Sender", true);
  ck("開回來後設定檔清乾淨（不留 true）", T.cfgKey() === "{}", T.cfgKey());
  ck("開回來後燃油回到 4.60", Math.abs(T.price().fuel - 4.60) < 0.005, T.price().fuel);

  /* 說明文字兩種語言都要有,而且 data-i18n 要真的換得掉 */
  run(`window.__h = {
    zh(){ LANG=0; applyLang(); return document.querySelector('[data-i18n="hint.accfuelmodal"]').textContent; },
    en(){ LANG=1; applyLang(); return document.querySelector('[data-i18n="hint.accfuelmodal"]').textContent; }
  };`);
  const H = w.__h;
  ck("說明文字有中文", /燃油/.test(H.zh()), H.zh().slice(0, 30));
  ck("說明文字有英文", /fuel/i.test(H.en()) && !/燃油/.test(H.en()), H.en().slice(0, 30));
  H.zh();

  /* ---- 全開 / 全關 ---- */
  T.none();
  ck("全關:每一格都未勾", T.boxes().every(b => !b.checked));
  ck("全關:燃油變成 0", Math.abs(T.price().fuel) < 0.005, T.price().fuel);
  T.all();
  ck("全開:每一格都勾起來", T.boxes().every(b => b.checked));
  ck("全開:設定檔清乾淨", T.cfgKey() === "{}", T.cfgKey());
  ck("全開:燃油回到 4.60", Math.abs(T.price().fuel - 4.60) < 0.005, T.price().fuel);
  ck("全開:摘要說全部都收", /都收|All charge/.test(T.summary()), T.summary());
  ck("全開:計數回到 27 / 27", T.count() === "27 / 27", T.count());
  ck("小視窗裡有 Save 按鈕", !!d.getElementById("bAfSave"));

  T.close();
  ck("關得掉", T.shown() === false);

  const scriptErrs = errs.filter(e => !/resource|Could not load|ENOENT|css|canvas|getContext/i.test(e));
  ck("頁面無腳本錯誤", scriptErrs.length === 0, scriptErrs.slice(0, 3).join(" | "));
  console.log(`\n${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error("HARNESS FAIL", e); process.exit(2); });
