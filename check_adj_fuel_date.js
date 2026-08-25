#!/usr/bin/env node
/* =====================================================================
   ADJ 燃油日期稽核
   ---------------------------------------------------------------------
   要回答的問題:
     跨期更正單(ADJ)的燃油,UPS 自己是按「原始出貨日」還是「ADJ 那一行
     自己的 Transaction Date」收的?

   工具目前(index.html:2569、UPS_Reprice_Tool.py:20586)取 ADJ 那一層自己
   的 Transaction Date。這個選擇只有在「ADJ 行的日期 != SHP 行的日期」時
   才有影響 —— 而哪一個對,帳單自己會講:UPS 在同一層開的 FSC 行,金額除
   以計費底就是它當時套用的百分比。

   做法不需要任何設定檔:先從 SHP 層彙總反推出這批帳單真實的每週燃油
   百分比(sum FSC / sum base,以週一為界),再用那張表去核對每一層。

   用法:
     node check_adj_fuel_date.js <帳單.csv> [更多帳單.csv ...] [--dump out.csv]
   ===================================================================== */

const fs = require("fs");

/* 欄位位置照 index.html:1245 的 FIXED_COLS(250 欄帳單沒有標題列)。 */
const COL = { INV_DATE: 4, INV_NO: 5, TRAN_DATE: 11, TRACKING: 20,
              LAYER: 34, DETAIL: 35, AR: 43, AS: 44, DESC: 45, NET: 52 };

/* 實測:UPS 沒有對這兩個代碼收燃油。ISW 是本批 5 期 5/5 一致的結果
   (見 README 的稽核紀錄);FTP 本來就是 0 元的第三方轉帳註記行。 */
const NON_FUEL_CODES = new Set(["FTP", "ISW"]);

const TOL = 0.011;     // 分位進位的容差
const MIN_BASE = 1;    // 底數小於這個數,反推出來的 % 沒有意義

const toNum = v => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[$,\s]/g, ""));
  return isFinite(n) ? n : 0;
};
/* 日期正規化照 index.html:1432 的 schedDate。 */
function schedDate(v) {
  const t = String(v == null ? "" : v).trim();
  if (!t || ["nan", "nat", "none"].indexOf(t.toLowerCase()) >= 0) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
       || /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(t)
       || /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0");
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/.exec(t);
  if (m) return m[3] + "-" + String(m[1]).padStart(2, "0") + "-" + String(m[2]).padStart(2, "0");
  return "";
}
/* 該日期所屬那一週的週一。UPS 的燃油每週一換。 */
function mondayOf(d) {
  const t = Date.parse(d + "T00:00:00Z");
  if (isNaN(t)) return "";
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86400000).toISOString().slice(0, 10);
}
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

/* 一個檔的所有行 -> 以「追蹤號 + 層別」分組。 */
function loadLayers(file) {
  const rows = parseCSV(fs.readFileSync(file, "utf8"));
  /* 有標題列就跳掉。UPS 下載回來的檔通常沒有。 */
  const body = String(rows[0][COL.TRAN_DATE] || "").trim() === "Transaction Date"
    ? rows.slice(1) : rows;
  const layers = new Map(), trackLayers = new Map();
  for (const r of body) {
    const tracking = String(r[COL.TRACKING] || "").trim();
    const layer = String(r[COL.LAYER] || "").trim().toUpperCase();
    if (!tracking || !["SHP", "ADJ", "RTN"].includes(layer)) continue;

    const key = tracking + "|" + layer;
    if (!layers.has(key))
      layers.set(key, { file, tracking, layer, dates: new Set(), fsc: 0, base: 0,
                        invoice: String(r[COL.INV_NO] || "").trim(),
                        invDate: schedDate(r[COL.INV_DATE]) });
    const o = layers.get(key);
    const d = schedDate(r[COL.TRAN_DATE]);
    if (d) o.dates.add(d);

    const ar = String(r[COL.AR] || "").trim().toUpperCase();
    const as = String(r[COL.AS] || "").trim().toUpperCase();
    const net = toNum(r[COL.NET]);
    if (ar === "FSC" && as === "FSC") o.fsc += net;
    else if (ar === "FRT") o.base += net;
    else if (ar === "ACC" && !NON_FUEL_CODES.has(as)) o.base += net;
    /* AR=INF 是純資訊行,金額 0,不進任何一邊。 */

    if (!trackLayers.has(tracking)) trackLayers.set(tracking, new Set());
    trackLayers.get(tracking).add(layer);
  }
  return { layers, trackLayers };
}
const dateOf = o => [...o.dates].sort()[0] || "";

/* 從 SHP 層反推每週的燃油百分比。單筆會被分位進位污染,所以是
   「整週的 FSC 總和 / 整週的底數總和」,不是逐筆取平均。 */
function deriveWeeklyTable(allLayers) {
  const wk = {};
  for (const o of allLayers) {
    if (o.layer !== "SHP" || !o.fsc || Math.abs(o.base) < MIN_BASE) continue;
    const d = dateOf(o); if (!d) continue;
    const m = mondayOf(d); if (!m) continue;
    (wk[m] = wk[m] || { f: 0, b: 0, n: 0 });
    wk[m].f += o.fsc; wk[m].b += o.base; wk[m].n++;
  }
  const table = {};
  for (const m of Object.keys(wk)) {
    const a = wk[m];
    if (a.n < 20 || Math.abs(a.b) < 500) continue;   // 樣本太少的週不採用
    table[m] = { pct: a.f / a.b * 100, n: a.n, base: a.b };
  }
  return table;
}
const pctFor = (table, d) => {
  const m = mondayOf(d);
  return (m && table[m]) ? table[m].pct : null;
};

function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--dump");
  const dumpPath = at >= 0 ? argv[at + 1] : "";
  /* at < 0 時 at+1 剛好是 0,會把第一個檔吃掉 —— 只有真的有 --dump
     才排除它後面那一個參數。 */
  const files = argv.filter((a, i) => at < 0 ? true : (i !== at && i !== at + 1));
  if (!files.length) {
    console.error("用法: node check_adj_fuel_date.js <帳單.csv> [...] [--dump out.csv]");
    process.exit(2);
  }

  const perFile = files.map(f => ({ f, ...loadLayers(f) }));
  const all = perFile.flatMap(x => [...x.layers.values()]);
  const table = deriveWeeklyTable(all);

  console.log("=".repeat(74));
  console.log("步驟 1 — 從 SHP 層反推這批帳單真實的每週燃油 %");
  console.log("=".repeat(74));
  const weeks = Object.keys(table).sort();
  if (!weeks.length) {
    console.log("樣本不足,無法反推週表。至少要有一期完整的 SHP 資料。");
    process.exit(1);
  }
  for (const m of weeks) {
    const t = table[m];
    const sun = new Date(Date.parse(m + "T00:00:00Z") + 6 * 86400000).toISOString().slice(0, 10);
    console.log(`  ${m} ~ ${sun}   n=${String(t.n).padStart(4)}`
      + `  底=${t.base.toFixed(0).padStart(7)}  →  ${t.pct.toFixed(3)}%`);
  }

  /* ---- 步驟 2:ADJ 行的日期跟原始出貨行一不一樣 ---- */
  console.log("");
  console.log("=".repeat(74));
  console.log("步驟 2 — ADJ 行的 Transaction Date 跟同一張發票上的原始出貨行一不一樣");
  console.log("=".repeat(74));
  let pairs = 0, same = 0, diff = 0; const diffs = [];
  for (const { layers, trackLayers } of perFile) {
    for (const [tracking, set] of trackLayers) {
      if (!set.has("ADJ")) continue;
      const ol = set.has("SHP") ? "SHP" : (set.has("RTN") ? "RTN" : "");
      if (!ol) continue;
      const a = dateOf(layers.get(tracking + "|ADJ"));
      const o = dateOf(layers.get(tracking + "|" + ol));
      if (!a || !o) continue;
      pairs++;
      if (a === o) same++;
      else { diff++; diffs.push({ tracking, ol, o, a, crossWeek: mondayOf(a) !== mondayOf(o) }); }
    }
  }
  console.log(`  同一張發票上同時有 ADJ 與 SHP/RTN 的追蹤號: ${pairs}`);
  console.log(`    日期相同: ${same}   日期不同: ${diff}`
    + (diff ? `   其中跨燃油週: ${diffs.filter(d => d.crossWeek).length}` : ""));
  for (const d of diffs.slice(0, 20))
    console.log(`      ${d.tracking}  ${d.ol} ${d.o} -> ADJ ${d.a}`
      + (d.crossWeek ? "   ← 跨週,這一筆決定答案" : "   (同一週,不影響)"));

  /* ---- 步驟 3:每一層用自己的日期,燃油對不對得上 UPS ---- */
  console.log("");
  console.log("=".repeat(74));
  console.log("步驟 3 — 用「該層自己的 Transaction Date」核對 UPS 實收燃油");
  console.log("=".repeat(74));
  const stat = {}, detail = [], outliers = [];
  let multiDate = 0, multiWeek = 0;
  for (const o of all) {
    if (o.dates.size > 1) {
      multiDate++;
      if (new Set([...o.dates].map(mondayOf)).size > 1) multiWeek++;
    }
    if (!o.fsc || Math.abs(o.base) < MIN_BASE) continue;
    const d = dateOf(o), p = pctFor(table, d);
    if (p === null) continue;
    const expect = o.base * p / 100, err = Math.abs(o.fsc - expect);
    const s = stat[o.layer] = stat[o.layer] || { ok: 0, bad: 0 };
    if (err <= TOL) s.ok++; else { s.bad++; outliers.push({ o, d, p, expect, err }); }
    detail.push({ file: o.file.split("/").pop(), invoice: o.invoice, tracking: o.tracking,
                  layer: o.layer, date: d, weekPct: p.toFixed(3), base: o.base.toFixed(2),
                  upsFuel: o.fsc.toFixed(2), expected: expect.toFixed(2),
                  diff: (o.fsc - expect).toFixed(2), ok: err <= TOL ? "Y" : "N" });
  }
  let tOk = 0, tBad = 0;
  for (const k of ["SHP", "RTN", "ADJ"]) {
    const s = stat[k]; if (!s) continue;
    const n = s.ok + s.bad; tOk += s.ok; tBad += s.bad;
    console.log(`  ${k}: ${s.ok}/${n} 完全一致 (${(s.ok / n * 100).toFixed(1)}%)`);
  }
  console.log(`  合計: ${tOk}/${tOk + tBad} (${(tOk / (tOk + tBad) * 100).toFixed(2)}%)`);

  if (outliers.length) {
    /* 換一週會差多少個百分點 —— 用來分辨「進位」與「套錯週」。 */
    const ps = weeks.map(m => table[m].pct);
    const spread = ps.length > 1 ? Math.max(...ps) - Math.min(...ps) : 0;
    console.log(`\n  對不上的 ${outliers.length} 筆(換一週會差最多 ${spread.toFixed(2)} 個百分點):`);
    for (const x of outliers.slice(0, 20)) {
      const pp = Math.abs(x.err / x.o.base * 100);
      console.log(`    ${x.o.tracking} ${x.o.layer} ${x.d}  底 ${x.o.base.toFixed(2)}`
        + `  應收 ${x.expect.toFixed(2)}  UPS ${x.o.fsc.toFixed(2)}  差 $${x.err.toFixed(2)}`
        + ` = ${pp.toFixed(3)} 個百分點  ${pp < spread / 2 ? "→ 進位" : "→ 可能套錯週"}`
        + (x.o.dates.size > 1 ? `  ⚠ 這一層有多個日期: ${[...x.o.dates].sort().join(" / ")}` : ""));
    }
  }
  if (multiDate)
    console.log(`\n  ⚠ 同一層帶多個 Transaction Date 的層: ${multiDate}`
      + `,其中跨燃油週: ${multiWeek}`
      + `\n    (跨週的那些,UPS 是對每一段各自套自己那一週的 %,工具是整層取一個日期)`);

  /* ---- 結論 ---- */
  console.log("");
  console.log("=".repeat(74));
  const crossWeekPairs = diffs.filter(d => d.crossWeek);
  if (!diff) {
    console.log("結論:ADJ 行一律沿用原始出貨日,取 ADJ 或取 SHP 結果相同,實作沒有風險。");
  } else if (!crossWeekPairs.length) {
    console.log("結論:有日期不同的 ADJ,但都落在同一個燃油週,金額不受影響。");
  } else {
    /* 多日期同層是另一回事:UPS 對每一段各自套自己那一週的 %,工具整層
       取一個日期,誤差來自這裡,不是「該不該用原始出貨日」。分開算。 */
    const bad = outliers.filter(x => x.o.layer === "ADJ" && x.o.dates.size === 1
      && Math.abs(x.err / x.o.base * 100) > 0.1).length;
    const split = outliers.filter(x => x.o.layer === "ADJ" && x.o.dates.size > 1).length;
    console.log(bad
      ? `結論:有 ${bad} 筆單一日期的 ADJ 用自己的日期算對不上,要人工看 —— 可能該用原始出貨日。`
      : "結論:跨週的 ADJ 用「自己的 Transaction Date」算,與 UPS 實收一致。"
        + "\n      目前 index.html:2569 / py:20586 的 ADJ→SHP→RTN 取法是對的,不用改。");
    if (split)
      console.log(`      另有 ${split} 筆是「同一層跨了兩個燃油週」造成的分位差,`
        + "與日期取法無關,見上方 ⚠。");
  }
  console.log("=".repeat(74));

  if (dumpPath && detail.length) {
    const cols = Object.keys(detail[0]);
    const esc = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    fs.writeFileSync(dumpPath,
      cols.join(",") + "\n" + detail.map(r => cols.map(c => esc(r[c])).join(",")).join("\n") + "\n");
    console.log(`\n逐層結果已寫到 ${dumpPath} (${detail.length} 列)`);
  }
}

main();
