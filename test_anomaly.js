/* 費用異常自動偵測:五個偵測器各自的門檻與不誤報。
   全部直接餵 ROWS / RATED 假資料 —— 偵測器讀的就是這兩個全域,
   不用把整套費率引擎跑起來,測的東西反而更準:只測統計,不測計價。 */
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
    /* 一列帳單行。預設 SHP / ACC,測試各自覆寫。 */
    line(o){
      return Object.assign({tracking:"", layer:"SHP", cls:"ACC", code:"", detail:"",
        desc:"", net:0, idx:0, invoice:"INV1", account:"A1"}, o);
    },
    /* 一筆已計價貨件。預設乾淨:算得出總額、沒有缺費率、沒有未知代碼。 */
    rated(o){
      const s=Object.assign({tracking:"T?", zone:"5", upsTotal:0, lines:[]}, o.s||{});
      return Object.assign({total:0, baseMissing:false, missFees:[], unknownNet:0,
        channel:"Ground Commercial", zoneUsed:"5", bw:{billable:10}}, o, {s:s});
    },
    seed(rows, rated){
      ROWS=rows; RATED=rated; ANOM_CACHE=null; ANOM_XP=null;
      return anomStats();
    },
    kinds(rows){ const by={}; for(const r of rows) by[r.kind]=(by[r.kind]||0)+1; return by; },
    spike(cur,hist){ return anomSpike(cur,hist); },
    card(){ return renderAnomCard(); },
  };`);

  const t = w.__t;
  const L = w.eval("typeof anomStats==='function' && typeof renderAnomCard==='function' && typeof exportAnoms==='function'");
  ck("三個進入點都在頁上", L === true);

  /* ---- 1. 疑似重複收費 ---- */
  console.log("[1] 重複收費");
  {
    const rows = [
      t.line({tracking:"TA1", code:"RES", desc:"Residential Surcharge", net:5.35, idx:10}),
      t.line({tracking:"TA1", code:"RES", desc:"Residential Surcharge", net:5.35, idx:11}),
      /* 有沖銷:兩正一負,淨額只剩一筆 —— 不是重複 */
      t.line({tracking:"TB2", code:"RES", net:5.35, idx:20}),
      t.line({tracking:"TB2", code:"RES", net:5.35, idx:21}),
      t.line({tracking:"TB2", code:"RES", net:-5.35, idx:22}),
      /* 出貨段與回程段各一次 LPS —— 層不同,正常 */
      t.line({tracking:"TC3", code:"LPS", net:54.60, idx:30, layer:"SHP"}),
      t.line({tracking:"TC3", code:"LPS", net:54.60, idx:31, layer:"RTN"}),
    ];
    const out = t.seed(rows, [t.rated({s:{tracking:"TA1"}})]);
    const by = t.kinds(out);
    ck("同號同層同代碼同金額 ×2 → 1 筆 dup", by.dup === 1, JSON.stringify(by));
    const dup = out.find(r => r.kind === "dup");
    ck("多收金額 = 一次的錢", dup && Math.abs(dup.amt - 5.35) < 0.005, dup && dup.amt);
    ck("指得出兩個帳單列號", dup && /10/.test(dup.line) && /11/.test(dup.line), dup && dup.line);
    ck("沖銷過的不算重複", !out.some(r => r.kind === "dup" && r.trk === "TB2"));
    ck("出貨+回程各一次 LPS 不算重複", !out.some(r => r.kind === "dup" && r.trk === "TC3"));
  }

  /* ---- 2. 附加費偏離主流價 ---- */
  console.log("[2] 附加費主流價");
  {
    const rows = [];
    for (let i = 0; i < 7; i++)
      rows.push(t.line({tracking:"TD"+i, code:"AHW", desc:"AHS Weight", net:14.06, idx:40+i}));
    rows.push(t.line({tracking:"TDx", code:"AHW", desc:"AHS Weight", net:28.12, idx:47}));
    /* 連續變動的代碼:七筆七個價,湊不出主流價,一筆都不該報 */
    for (let i = 1; i <= 7; i++)
      rows.push(t.line({tracking:"TE"+i, code:"OVR", net:i*3, idx:50+i}));
    const out = t.seed(rows, [t.rated({s:{tracking:"TD0"}})]);
    const by = t.kinds(out);
    ck("偏離主流價的那一筆被列出", by.accp === 1, JSON.stringify(by));
    const a = out.find(r => r.kind === "accp");
    ck("金額 = 與主流價的差", a && Math.abs(a.amt - 14.06) < 0.005, a && a.amt);
    ck("沒有主流價的代碼整組跳過", !out.some(r => r.kind === "accp" && r.code === "OVR"));
  }

  /* ---- 3. 運費離群 ---- */
  console.log("[3] 運費離群");
  {
    const mk = (trk, frt, lb) => t.rated({bw:{billable:lb}, total:frt*2,
      s:{tracking:trk, upsTotal:frt*2, lines:[{cls:"FRT", net:frt, idx:60}]}});
    const rated = [];
    for (let i = 0; i < 8; i++) rated.push(mk("TF"+i, 10, 10));
    rated.push(mk("TFx", 30, 10));
    let out = t.seed([], rated);
    let by = t.kinds(out);
    ck("九件裡一件 3 倍單價 → 1 筆 frt", by.frt === 1, JSON.stringify(by));
    const f = out.find(r => r.kind === "frt");
    ck("金額 = 超出中位數口徑的部分", f && Math.abs(f.amt - 20) < 0.01, f && f.amt);
    /* 不足 8 件的組不比 —— 樣本太小,中位數自己都站不穩 */
    out = t.seed([], rated.slice(0, 6).concat([mk("TFy", 30, 10)]));
    ck("組內不足 8 件不報", !out.some(r => r.kind === "frt"));
  }

  /* ---- 4. 應收低於 UPS 成本 ---- */
  console.log("[4] 低於成本");
  {
    const rated = [
      t.rated({total:5,  s:{tracking:"TG1", upsTotal:20}}),
      t.rated({total:5,  s:{tracking:"TG2", upsTotal:20}, missFees:["AHS Weight"]}),
      t.rated({total:19.8, s:{tracking:"TG3", upsTotal:20}}),
    ];
    const out = t.seed([], rated);
    const losses = out.filter(r => r.kind === "loss");
    ck("低於成本的那一筆被列出", losses.length === 1, losses.length);
    ck("是乾淨的那一筆,缺費率的不列", losses[0] && losses[0].trk === "TG1");
    ck("差兩毛的不吵人(門檻半塊錢)", !losses.some(r => r.trk === "TG3"));
  }

  /* ---- 5. 跨期跳升(純函式) ---- */
  console.log("[5] 跨期跳升");
  {
    const h = a => ({trkN:10, by:{ADC:{amt:a, desc:"Address Correction"}}});
    let rows = t.spike({trkN:10, by:{ADC:{amt:80, desc:"Address Correction"}}}, [h(10), h(10), h(12)]);
    ck("平均每件 8 倍於往期 → 報", rows.length === 1 && rows[0].code === "ADC", JSON.stringify(rows));
    /* 出貨量翻倍、總額跟著翻倍:平均沒變,不是異常 */
    rows = t.spike({trkN:20, by:{ADC:{amt:20}}}, [h(10), h(10), h(10)]);
    ck("量大導致總額變大不報", rows.length === 0, JSON.stringify(rows));
    rows = t.spike({trkN:10, by:{NEW:{amt:30, desc:"Never Seen"}}}, [h(10), h(10), h(10)]);
    ck("往期沒出現過的新代碼要報", rows.length === 1 && rows[0].code === "NEW");
    rows = t.spike({trkN:10, by:{ADC:{amt:80}}}, [h(10), h(10)]);
    ck("往期不足三期整個不比", rows.length === 0);
  }

  /* ---- 6. 卡片 ---- */
  console.log("[6] 卡片");
  {
    t.seed([
      t.line({tracking:"TA1", code:"RES", net:5.35, idx:10}),
      t.line({tracking:"TA1", code:"RES", net:5.35, idx:11}),
    ], [t.rated({total:5, s:{tracking:"TG1", upsTotal:20}})]);
    const html = t.card();
    ck("卡片畫得出來且含下載鈕", /bAnmXls/.test(html), html.slice(0, 120));
    ck("有高嚴重度時掛警示框", /issbox warn/.test(html));
    ck("表格列印那一句『和誰比』", /billed 2 times|收了 2 次/.test(html));
    const clean = w.eval(`ROWS=[]; RATED=[__t.rated({total:20, s:{tracking:"TZ", upsTotal:20}})];
      ANOM_CACHE=null; ANOM_XP=null; renderAnomCard();`);
    ck("乾淨期別給一行『未偵測到』,不裝死", /no anomalies|未偵測到/.test(clean), clean.slice(0, 160));
    ck("沒有已計價資料時整張卡不出現", w.eval("RATED=[]; ANOM_CACHE=null; renderAnomCard()") === "");
  }

  console.log(`\n── ${pass} pass / ${fail} fail ──`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error("harness error", e); process.exit(1); });
