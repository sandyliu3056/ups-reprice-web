/* 從這個資料夾產生手冊 PDF:
     npm i -D playwright && node docs/ups-api-manual/build.mjs
   截圖在 shots/,要更新畫面就重拍同名檔案再跑一次。
   用 Chromium 轉,不用 reportlab —— 中文字型和排版都由瀏覽器處理。

   PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM 兩個環境變數是給「playwright 不是
   裝在這個專案底下」的情況用的(CI 的共用映像檔之類),平常兩個都不用設。 */
const mod = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = mod.default || mod;

const DIR = new URL('.', import.meta.url).pathname;
const OUT = DIR + '../../UPS-API-Setup-Guide.pdf';
/* 檔名刻意用 ASCII:Chromium 會把 <a download> 裡的非 ASCII 檔名整個丟掉,
   存下來會變成沒有副檔名的 "download"。設定頁那顆下載按鈕抓的就是這個檔。 */

const b = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('file://' + DIR + '/manual.html', { waitUntil: 'networkidle' });

/* 確認每張圖都載到了,不要產出破圖的 PDF */
const imgs = await page.evaluate(() => [...document.images].map(i =>
  ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth })));
console.log('圖片:'); imgs.forEach(i => console.log('  ', i.ok ? '✓' : '✗', i.src, i.w + 'px'));
if (imgs.some(i => !i.ok)) { console.log('有圖沒載到,停手'); await b.close(); process.exit(1); }

await page.pdf({ path: OUT, format: 'A4', printBackground: true,
  margin: { top: '16mm', bottom: '14mm', left: '15mm', right: '15mm' } });
console.log('寫出:', OUT);
console.log('errors:', errs.length ? errs : 'none');
await b.close();
