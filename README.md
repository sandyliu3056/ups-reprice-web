# UPS Reprice — 部署包

兩套東西:**網頁版**(新做的)和**桌面版打包**(既有的 Python 工具)。

---

## web/index.html — 網頁版

主程式為 `index.html`,登入設定由 `auth-config.js` 提供。正式使用時需透過
HTTPS 網站開啟,不能再把單一 HTML 當作安全登入工具。

### 登入

登入已改用 Supabase Auth。Repository 和瀏覽器不儲存使用者密碼,未登入時
只會顯示登入頁。公開註冊應關閉,帳號由擁有者在 Supabase 後台建立、停用
或重設密碼。完整設定方式請看 `SUPABASE_SETUP.md`。

舊版曾把密碼提交到公開 Git 歷史,所以原有密碼都必須更換。

### 分頁

| 分頁 | 內容 |
|---|---|
| 📁 匯入檔案 | 選帳單、產生報表、匯出對帳單 |
| 💲 附加費設定 | 燃油(可按渠道設不同期間,日期用內建月曆挑)、28 條渠道的附加費率、申報價值級距 |
| 📏 尺寸規則 | DIM 除數、AHS/LPS 十二個門檻、批量設定渠道 |
| 🚚 渠道 | 新增渠道、基本運費表匯出匯入、全部渠道一覽 |
| ⚡ Demand | 四個子分頁 |
| 📚 帳單歷史 | 匯入過去帳單、查追蹤號、計費計算明細 |
| 🔎 代碼查詢 | 52 個代碼參考,標出未收錄的 |
| 🛡️ 管理員 | 只有 admin 可查看 Supabase 成功登入紀錄並匯出 CSV |

### 費率從哪來

**程式裡不含任何費率。** 內建的只有結構:15 種服務、Zone 清單、UPS 公告門檻、52 個代碼。金額全部是空的。

要算錢,在「附加費設定」載入你自己的 `ups_billing_tool_config.json`,或用範本匯入。載過一次就記在這台瀏覽器。

「匯出附加費模板」倒出來的是**目前選定渠道**的那一份,Zone 就是那個渠道自己的那組(Ground 是 2–8 / 44–46,Next Day Air Saver 是 132–138)。已經有費率的會帶出現值,沒設過的留空等填。

### 引擎移植到哪

照 `UPS_Reprice_Tool.py` v170 移植,不是重寫。已完成:

- 運費查表(service × residential × zone × 計費重量)
- 計費重量:DIM、AHS-Dimension 最低計費重(**只套 Dimension**,Weight 和 Packaging 沒有下限)
- AHS / LPS 門檻判定
- 35 個收費代碼,含 17 種附加費(`AHB` / `AHD` 排除,你確認過 37 期都沒出現)
- 宣告價值級距(超過免費上限全額計費、含第一單位)
- 燃油,可按渠道設不同期間
- 跨期 ADJ/SCC 依歷史判定住宅或商業

**尚未移植**(畫面上會標出來,不會填 0):跨期 SCC 的幾個分支、住宅商業重分類的 ADJ 修正、Not Previously Billed、Demand 的實際計算。

### 要確認算得對

同一張帳單,桌面版跑一次、網頁版跑一次,**先比計費重量那一欄,不要先比總額**。總額含尚未移植的部分,一定對不起來;計費重量對了才代表 DIM 除數、AHS 門檻、最低計費重讀對了。

匯出對帳單,用追蹤號 join 比對。有差的追蹤號給我,我照原始碼查是哪條規則沒跟上。

### 場景

底部那條場景會跟著**選定時區的當地時間**變天色。天空是上下漸層,天頂和地平線分開算——黎明和黃昏是天頂藍、地平線橘,不是整片橘。夜晚深藍配月亮和星星,傍晚偏紫。太陽和月亮走各自的弧線。

天氣會蓋過時段的暖色:陰雨天不管幾點都是壓暗降飽和的,但仍然帶藍——灰的是雲不是天。陰雨的半夜比陰雨的中午更暗。

天氣有晴、多雲、雨、**雷雨**、雪五種畫法。下雨、下雪或打雷時,**戶外(Tally)的工人會撐傘、貓狗會穿雨衣**;Scoobi 是倉庫裡面所以不穿。

雷雨每隔幾秒閃一次,閃電那一瞬間**貓會被嚇到炸毛**——雷是全場共用一個時間點,所以牠們會同時反應。

貓狗會自己走動,貓走路是四腳站姿、坐下才變回坐姿。點下去各有反應:狗抬腿尿尿、貓炸毛、工人一邊走一邊揮手。

預設主題是 **Tally**(戶外貨場),可在頂列切換成 Scoobi(室內倉庫)。

### 會連外的地方

| 網址 | 何時 |
|---|---|
| `api.open-meteo.com` | 開機自動抓一次天氣,只用來決定場景畫晴天還是雨天。查的是時區對應的城市,不是你的位置,不需要定位權限。連不到就靜靜畫晴天。 |
| `billing.ups.com` | 只有按「UPS 帳單中心」才開 |
| `ups.com/.../fuel-surcharges` | 只有按「查詢燃油費率」才開 |

**帳單資料完全不會離開瀏覽器。** 上面三個都跟你的檔案無關。

不想連天氣的話,把 `WX={mode:"clear", live:true...}` 的 `live` 改成 `false`,整份檔案就零網路請求。

### 放上網

建議將 GitHub Repository 設成 Private,再用支援 Private Repository 的平台
部署公開網址。訪客可以開啟網址,但必須通過 Supabase 登入才能看到工具。
Supabase Project URL 與 anon/publishable key 填在 `auth-config.js`;絕對不能把
`service_role` 或其他 secret key 放進前端。

---

## desktop/ — 桌面版打包

| 檔案 | 用途 |
|---|---|
| `DEPLOY.md` | 完整說明,先看這份 |
| `UPS_Reprice_Tool.spec` | PyInstaller 設定,onedir,已收 customtkinter 佈景與 tzdata |
| `build.bat` | 放在 `UPS_Reprice_Tool.py` 旁邊雙擊 |
| `requirements.txt` | 相依套件 |
| `verify_deploy.py` | 兩台各跑一次,對 config 的 sha256 與各項筆數 |
| `make_sample_config.py` | 從真的 config 產出可以進 git 的樣本 |
| `gitignore.txt` | 改名成 `.gitignore` |
| `githooks/pre-commit` | 擋客戶資料進 git,`git add -f` 也擋得住 |

安裝 hook:`git config core.hooksPath .githooks`

**三個重點:**

1. exe 不是重點,跟著走的檔案才是。少了 `ups_billing_tool_config.json` 就是全新空白設定;少了 `ups_history.sqlite3`,跨期 ADJ/SCC 的住宅商業會判錯。
2. spec 用 onedir 不是 onefile。onefile 每次啟動要解壓 pandas,冷開機十幾秒。
3. 字型只影響外觀,不影響金額。

---

## tools/ — 稽核

| 檔案 | 用途 |
|---|---|
| `audit_git.py` | 查一個 repo 的完整歷史,含已刪除但還在歷史裡的檔案 |
| `find_my_files.py` | 掃全機:每一份 config 和 history 在哪、哪一份有真資料 |

兩支都唯讀,放哪都能跑。偵測的是**形狀**(`1Z` 開頭的追蹤號、`0000` 開頭的發票號、`C:\Users\` 路徑),沒有把帳號寫死在裡面——那樣這兩支工具本身就會變成外洩源。

---

## 三件事別忘了

**客戶費率不能進公開 repo。** `ups_billing_tool_config.json` 是 1,500 列議價費率,`ups_history.sqlite3` 是 104,463 列帳單明細。兩個都在 `.gitignore` 裡,pre-commit hook 也會擋。

**`UPS_Reprice_Tool.py` 第 4870 行的註解引用了一組實際發票號**,裡面含你的 UPS 帳號。那份原始碼現在在公開 repo 上,改掉那一行。

**網頁版的密碼是明文。** 發給同事之前想清楚這個檔案會流到哪裡。
