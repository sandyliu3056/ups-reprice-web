/* 從這個資料夾產生兩份手冊 PDF(中文與英文):
     npm i -D playwright && node docs/ups-api-manual/build.mjs
   截圖在 shots/(中文)與 shots/en/(英文),要更新畫面就跑 shots.mjs 重拍。
   用 Chromium 轉,不用 reportlab —— 中文字型和排版都由瀏覽器處理。

   PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM 兩個環境變數是給「playwright 不是
   裝在這個專案底下」的情況用的(CI 的共用映像檔之類),平常兩個都不用設。 */
const mod = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = mod.default || mod;

const DIR = new URL('.', import.meta.url).pathname;
/* 檔名刻意用 ASCII:Chromium 會把 <a download> 裡的非 ASCII 檔名整個丟掉,
   存下來會變成沒有副檔名的 "download"。設定頁那顆下載按鈕抓的就是這兩個檔;
   中文版的檔名不能改 —— 已經部署出去的那些是照這個名字找的。 */
const EDITIONS = [
  { src: 'manual.html',    out: '../../UPS-API-Setup-Guide.pdf',    label: '中文' },
  { src: 'manual.en.html', out: '../../UPS-API-Setup-Guide-EN.pdf', label: 'English' },
];

const b = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
let bad = 0;
for (const ed of EDITIONS) {
  console.log('—', ed.label, '—');
  const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('file://' + DIR + ed.src, { waitUntil: 'networkidle' });

  /* 確認每張圖都載到了,不要產出破圖的 PDF */
  const imgs = await page.evaluate(() => [...document.images].map(i =>
    ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth })));
  imgs.forEach(i => console.log('  ', i.ok ? '✓' : '✗', i.src, i.w + 'px'));
  if (imgs.some(i => !i.ok)) { console.log('  有圖沒載到,這一份跳過'); bad++; await page.close(); continue; }

  await page.pdf({ path: DIR + ed.out, format: 'A4', printBackground: true,
    margin: { top: '16mm', bottom: '14mm', left: '15mm', right: '15mm' } });
  console.log('   寫出:', ed.out.replace('../../', ''));
  console.log('   errors:', errs.length ? errs : 'none');
  await page.close();
}
await b.close();
if (bad) process.exit(1);
