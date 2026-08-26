import { chromium } from 'playwright';   /* npm i -D playwright */
/* 從這個資料夾產生手冊 PDF:
     node docs/ups-api-manual/build.mjs
   截圖在 shots/,要更新畫面就重拍同名檔案再跑一次。
   用 Chromium 轉,不用 reportlab —— 中文字型和排版都由瀏覽器處理。 */
const DIR = new URL('.', import.meta.url).pathname;
const b=await chromium.launch();
const page=await b.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto('file://'+DIR+'/manual.html',{waitUntil:'networkidle'});
/* 確認四張圖都載到了,不要產出破圖的 PDF */
const imgs=await page.evaluate(()=>[...document.images].map(i=>
  ({src:i.getAttribute('src'), ok:i.complete && i.naturalWidth>0, w:i.naturalWidth})));
console.log('圖片:'); imgs.forEach(i=>console.log('  ',i.ok?'✓':'✗',i.src,i.w+'px'));
if(imgs.some(i=>!i.ok)) { console.log('有圖沒載到,停手'); await b.close(); process.exit(1); }
await page.pdf({ path: DIR+'../../UPS-API-手冊.pdf', format:'A4', printBackground:true,
  margin:{top:'16mm',bottom:'14mm',left:'15mm',right:'15mm'} });
console.log('errors:', errs.length?errs:'none');
await b.close();
