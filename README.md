# UPS Reprice — 部署包

兩套東西:**網頁版**(新做的)和**桌面版打包**(既有的 Python 工具)。

---

## web/index.html — 網頁版

單一檔案,193 KB,雙擊就能開,不需要伺服器。圖示內嵌,不用另外放檔案。

### 帳號

| Name | Role | Username | Password |
|---|---|---|---|
| Sandy Liu | admin | `sandy` | `sandy-dev` |
| Candy | user | `candy` | `candy-geniqua` |
| Quincy | user | `quincy` | `quincy-geniqua` |
| Terry | user | `terry` | `terry-geniqua` |
| Eunice | user | `eunice` | `eunice-programmar` |

**密碼是明文,就寫在這個檔案裡。** 開得了這個檔案或這台瀏覽器的人,看得到所有人的密碼。這只是分角色,不是保護——所以這個檔案本身要當成機密看待。

八個分頁對所有人開放,admin 多一個「👤 Users」:改姓名、角色、帳號、密碼(按 Edit 解鎖那一列,Save 或 Cancel),以及看誰在什麼時間做了什麼。

活動紀錄和帳號改動都只存在**那一台瀏覽器**。要跨機器看,同事按「匯出紀錄」、你按「匯入紀錄」合併;要讓同事套用新帳號,按「下載帳號檔」重發。

### 分頁

| 分頁 | 內容 |
|---|---|
| 📁 匯入檔案 | 選帳單、產生報表、匯出對帳單 |
| 💲 附加費設定 | 燃油(可按渠道設不同期間)、28 條渠道的附加費率、申報價值級距 |
| 📏 尺寸規則 | DIM 除數、AHS/LPS 十二個門檻、批量設定渠道 |
| 🚚 渠道 | 新增渠道、基本運費表匯出匯入、全部渠道一覽 |
| ⚡ Demand | 四個子分頁 |
| 📚 帳單歷史 | 匯入過去帳單、查追蹤號、計費計算明細 |
| 🔎 代碼查詢 | 52 個代碼參考,標出未收錄的 |
| 👤 帳號 | 僅 admin |

### 費率從哪來

**程式裡不含任何費率。** 內建的只有結構:15 種服務、Zone 清單、UPS 公告門檻、52 個代碼。金額全部是空的。

要算錢,在「附加費設定」載入你自己的 `ups_billing_tool_config.json`,或用範本匯入。載過一次就記在這台瀏覽器。

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

底部那條場景會跟著**選定時區的當地時間**變天色:清晨橘紅、白天藍、黃昏橘、傍晚紫灰、夜晚深藍配月亮和星星。太陽和月亮走各自的弧線。

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

放 GitHub Pages 把 `index.html` 放進 repo 根目錄即可。這個檔案裡沒有費率,但**有明文密碼**——repo 公開的話密碼就公開了。要放公開 repo,先把 `ACCOUNTS` 那段換成假的。

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
