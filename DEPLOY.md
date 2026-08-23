# UPS Reprice Web — 部署包

2026-08-24 版。這一版修了跨期更正的三件事,計價結果與桌面版 v170 逐號比對過。

## 包了什麼

| 檔案 | 要不要上傳 |
|---|---|
| `index.html` | 要。整個工具就這一份 |
| `auth-config.js` | 要。只放 Project URL 與 anon/publishable key |
| `.gitignore` | 要 |
| `.githooks/pre-commit` | 要 |
| `supabase-js-2.112.3.js` | 要。登入用的 Supabase 用戶端 |
| `xlsx-0.18.5.full.min.js` | 要。寫 Excel 檔的元件 |
| `.nojekyll` | 要,如果部署在 GitHub Pages |

**不在包裡、也不該進 repo 的:**`ups_billing_tool_config.json`(你的合約費率)、`ups_history.sqlite3`、任何帳單 CSV 或 xlsx。費率是每次開工具時自己載進去的,不是打包進去的。

## 上線

1. Repository 設 **Private**,用支援 private repo 的平台(Vercel、Cloudflare Pages、Netlify)部署。訪客開得了網址,但要過 Supabase 登入才看得到工具。
2. 安裝 hook:`git config core.hooksPath .githooks`
3. `auth-config.js` 只填 Project URL 與 anon/publishable key。**service_role 或任何 secret key 絕對不能進前端** —— hook 會擋 JWT 形狀的字串與 Supabase secret key 前綴,但別靠它。
4. Supabase 那邊要先跑過 `supabase/login_history.sql`,不然登入紀錄那頁會顯示錯誤。這支 SQL 不在這個包裡。

## 上線後先驗這三件

1. 開網址 → 登入 → 載入 `ups_billing_tool_config.json` → 跑一張帳單 → 下載 xlsx。
2. 拿同一張帳單在桌面版跑一次,**先比計費重量欄**,再比總額。
3. 開 DevTools → Application → IndexedDB,確認 `ups_reprice_hist` 有東西。

## 跨期更正要有歷史才準

這一版的跨期更正(SCC / ZONE)會去 IndexedDB 找原始出貨那一筆,用它的服務別、住商、Zone、實重、尺寸算出原本收過的那一段,只收差額。

**IndexedDB 是綁瀏覽器的。** 換一台電腦、換一個瀏覽器、無痕視窗,都等於沒有歷史 —— 這時跨期單會收全額,並在問題欄標出來。所以新機器上線後,要把前幾期的帳單依序跑一次(或用歷史頁匯入),把歷史建起來再開始對客戶收錢。

## 這一版動到金額的地方

| 改動 | 影響 |
|---|---|
| 歷史住商查詢限縮到 ADJ 層 | 純退件(Undeliverable Return)不再誤套原出貨的住宅費率 |
| 跨期 SCC 用歷史原件抵差額 | 原件不在同一期時,不再重複收原本已收過的那一段 |
| C / A 兩側 Zone 拆開 | 有 ZONE 調整行時,C 用更正後的 Zone,A 用原本的 |
| DIN 攔截不抵差 | 退回寄件人是新運費,全額收,不拿原件去抵 |
| RADJ 轉商業時不收住宅口味的桶 | RES 與住宅 DAS 跟著轉,商業側 LDC / RDC 照常 |

已知還沒收乾淨,都在 `diff_336_after_fix.csv`:兩筆 RADJ 沒換 DAS 桶的、一筆掛在退件上的跨期 SCC 住商判定(差 3 分)、以及約 190 列 ±0.01 的燃油進位差(桌面版逐列先進位,這裡匯出才進位)。

## 連外的地方

只有三個,都跟帳單無關:開機抓一次天氣(`api.open-meteo.com`,連不到就畫晴天)、按鈕才開的 UPS 帳單中心與燃油費率頁、以及按到 Excel 才載的 SheetJS(版本鎖死並附 SRI)。

**匯出的檔一律是 xlsx** —— 報表、對帳單、模板、自訂附加費清單、登入紀錄,沒有一個是 CSV。

對帳單和桌面版 Generate Profit Report 同一份版面:每個期號一張工作表(表名 MMDDYY),外加 Overview;帳戶層費用與兩邊對不上的追蹤號放在 Account Charges。唯一做不到的是凍結標題列 —— 免費版的 SheetJS 不支援,資料完全一致。桌面版跟著改:`_rate_issues` 也是 xlsx 了。

登入用的 Supabase 用戶端與寫 Excel 的元件都放在網站自己的目錄裡,不跟 CDN 拿 —— 版本不會在你不知情的時候換掉,CDN 掛了也不影響登入。要升版就換掉那個檔,並改 `index.html` 裡引用的檔名。

**六個檔全部平放在同一層,不要放進子資料夾。** GitHub Pages 會跳過 `vendor/`、`_` 開頭之類的路徑不發布,檔案在 repo 裡看得到、網址上卻是 404。`.nojekyll` 是同一件事的保險。

登入畫面說某個檔沒載到時,直接把那個檔的網址打開(例如 `你的網址/supabase-js-2.112.3.js`)。看到 404 就是沒發布上去,不是程式的問題。

**帳單資料完全不離開瀏覽器。**
