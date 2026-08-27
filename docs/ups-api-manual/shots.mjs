/* 重拍手冊裡的三張截圖(中英各一組):
     python3 -m http.server 8731            # 在儲存庫根目錄
     node docs/ups-api-manual/shots.mjs
   中文寫進 shots/,英文寫進 shots/en/,檔名相同。
   端點欄位一律填佔位字串 —— 手冊是給客人看的,不能把我們自己的專案編號
   印在圖裡,而且他們照著填的本來就該是自己的。
   PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM 用法同 build.mjs。 */
const mod = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = mod.default || mod;
const DIR = new URL('.', import.meta.url).pathname;
const BASE = process.env.SHOT_BASE || 'http://localhost:8731/index.html';
const USER = process.env.SHOT_USER || 'test';
const PASS = process.env.SHOT_PASS || 'ups-test-2026';
const ENDPOINT = 'https://<your-project-ref>.supabase.co/functions/v1/ups-address';

const b = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await b.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#inUser', USER); await page.fill('#inPw', PASS); await page.click('#bLogin');
await page.waitForFunction(() => typeof ME !== 'undefined' && !!ME && typeof CFG !== 'undefined' && !!CFG,
                           null, { timeout: 30000 });

const clip = async (sel, dir, name) => {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  await el.screenshot({ path: `${DIR}shots/${dir}${name}.png` });
  console.log('  ✓', dir + name);
};

for (const [lang, dir] of [[0, ''], [1, 'en/']]) {
  await page.evaluate(l => { LANG = l; applyLang(); }, lang);
  await page.evaluate(() => {
    const g = CFG.raw.global_rules || (CFG.raw.global_rules = {});
    g.resi_source = 'system'; g.resi_api_url = ''; CFG = readConfig(CFG.raw);
    showTab('setting'); renderConfigTabs();
  });
  await page.waitForTimeout(450);
  await clip('#p-setting .lf', dir, '07-settings');
  await page.click('#bResiSrc'); await page.waitForTimeout(400);
  await clip('#rsModal', dir, '08-resi-panel');
  await page.click('#resiSrcApi'); await page.waitForTimeout(200);
  await page.fill('#resiApiUrl', ENDPOINT);
  await page.evaluate(() => $('#resiApiUrl').dispatchEvent(new Event('change')));
  await page.waitForTimeout(300);
  await clip('#rsModal', dir, '09-resi-api');
  await page.evaluate(() => { const x = document.querySelector('#rsModal .mx'); if (x) x.click(); });
  await page.waitForTimeout(250);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
