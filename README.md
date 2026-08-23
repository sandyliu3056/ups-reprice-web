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
| ⚡ Demand | 四個子分頁,已接進計價 |
| 📚 帳單歷史 | 匯入過去帳單、查追蹤號、計費計算明細 |
| 🔎 代碼查詢 | 52 個代碼參考,標出未收錄的 |
| 🛡️ 管理員 | 只有 admin 可查看 Supabase 成功登入紀錄並匯出 CSV |

### 沒有標題列的帳單

UPS 下載回來的 250 欄 CSV **沒有標題列**,直接從資料列開始。欄位位置照桌面版
的常數:出貨日 11、輸入重量 26、計費重量 28、Billed Weight Type 31、
Package Dimensions 32、Zone 33、Charge Category Code 34、Detail Code 35、
Classification 43、Description Code 44、Description 45、Net Amount 52、
Detail Keyed Dimensions 225。

有標題列時照名字對,沒有就用位置。Zone 在帳單上是補零的三位數(`008`),
會先去掉結尾的 `.0` 再去掉前導零,才對得上費率表的 `Zone 8`。

### 檔案格式

匯入類的欄位一律吃 **CSV / TXT / XLSX / XLS**,五個入口都一樣:

| 入口 | 位置 |
|---|---|
| 帳單 | 📁 匯入檔案 |
| 過去各期帳單 | 📚 帳單歷史 |
| 基本運費表 | 🚚 渠道 |
| 附加費率 | 💲 附加費設定 |
| 動態匯入 | ⚡ Demand |

Excel 交給 SheetJS 轉成 CSV 文字後再解析,所以兩種格式走的是同一條解析路徑,
結果一致。幾個實作上的注意事項:

- **只讀第一個有資料的工作表。** 封面頁(只有一兩格字)會自動跳過,找第一個
  兩列以上的表。想指定工作表就把它移到最前面,或另存成 CSV。
- **日期輸出 `yyyy-mm-dd`**,不會變成 Excel 序號那串數字。
- **SheetJS 是按到 Excel 檔才去載的**,版本鎖死並附 SRI。純 CSV 流程完全不連外。
  離線環境要用 Excel 匯入的話,會載不到而失敗,改存 CSV 即可。

設定檔(`ups_billing_tool_config.json`)只吃 JSON,那不是表格。

### 跟桌面版共用模板

網頁版與 `UPS_Reprice_Tool.py` 讀寫同一組活頁簿,兩邊的檔案可以互丟:

| 模板 | 工作表 | 欄位 |
|---|---|---|
| 基本運費 | `Base Rates` | `Service` / `Weight` / `Zone 2` … |
| | `_ChannelInfo`(隱藏) | `Service` / `Channel Type` / `Built By` |
| 附加費 | `AHS_LPS` | `Fee Type` / `Shipment Type` / `Zone 2` … |
| | `FLAT_CHARGES` | `Fee Type` / [`Shipment Type`] / `Amount` |

幾件會影響結果的事:

- **渠道以檔案為準,不是畫面上選的那條。** 基本運費匯入會先讀 `_ChannelInfo`,
  和畫面選的不一樣時以檔案為準,狀態列會註明。選錯渠道不會再把費率悄悄寫到
  別條線上。沒有 `_ChannelInfo` 時才依序看表身的 `Service` / `Residential` 欄,
  最後才用畫面上選的。
- **Fee Type 兩邊用詞不同,靠對照表換算。** 檔案裡是 UPS 的長名稱
  (`Additional Handling Surcharge - Weight`),設定檔裡是短鍵(`AHS Weight`)。
  對照表照抄桌面版的 `FEE_TYPE_DISPLAY_NAMES`,舊模板用過的名字也收著。
- **整列 Zone 全空白的那一列會跳過。** 那是還沒填的空模板,不是費率 0。
  匯進去會把現有費率蓋成一張全 0 的表。
- **`FLAT_CHARGES` 沒有 `Shipment Type` 欄時**(桌面版的全渠道模板就是這樣),
  一列費用寫進每一條走標準 Zone(2–8 / 44–46)的渠道,跟桌面版一致。
- **匯出是 xlsx**,桌面版可直接匯入。SheetJS 載不到時退回 CSV,欄位一樣但只有
  網頁版讀得了。

### 費率從哪來

**程式裡不含任何費率。** 內建的只有結構:15 種服務、Zone 清單、UPS 公告門檻、52 個代碼。金額全部是空的。

要算錢,在「附加費設定」載入你自己的 `ups_billing_tool_config.json`,或用範本匯入。載過一次就記在這台瀏覽器。

「匯出附加費模板」倒出來的是**目前選定渠道**的那一份,Zone 就是那個渠道自己的那組(Ground 是 2–8 / 44–46,Next Day Air Saver 是 132–138)。已經有費率的會帶出現值,沒設過的留空等填。

### 每條渠道的規則怎麼生效

AHS / LPS 的門檻、開關、最低計費重與 DIM 除數,都是「全域當底、渠道疊上去」,
空白 = 沿用全域,和桌面版 `channel_rules()` 同一套。所以在 📏 尺寸規則裡替某
一條線設的值,現在真的會用在那條線上,不會被全域值蓋掉。

十一個數值欄位:LPS 最長邊 / 實際重量 / 材積 / 長+圍 / 最低計費重,
AHS 重量 / 最長邊 / 第二長邊 / 材積 / 長+圍 / 最低計費重。
九個開關:上述每一條觸發條件都能單獨關掉,關掉就不觸發,沒設過視為開。

### 燃油

先決定用哪一組:渠道自己有排程、或自己填了百分比 → 用渠道的(只填百分比
沒排程就沿用全域排程);否則用全域的。再按出貨日挑期間,頭尾都含。

沒有出貨日期、或當天不在任何期間內,退回百分比並在 issue 欄標出來 ——
燃油差一個百分點,整批金額就跟著差,不能無聲退回。

### DIM 除數

取值順序與桌面版一致:

1. 渠道自己的除數(🚚 渠道 / 📏 尺寸規則裡設的,或自訂渠道登錄的)
2. 📏 尺寸規則的「預設 DIM factor」
3. UPS 公告的 139

一到三都沒有值才會落到 139,而且會在 issue 欄標出來 —— 退到 139 會改變那條
渠道上每一件的計費重量,不能悄悄發生。

設定檔裡的 `global_rules.dim_factor` 不參與計算,桌面版也是只存不用。要改整
個帳號的除數,改「預設 DIM factor」;要單獨改一條線,改那條渠道的。

### 引擎移植到哪

照 `UPS_Reprice_Tool.py` v170 移植,不是重寫。已完成:

- 運費查表(service × residential × zone × 計費重量)
- 計費重量:DIM、AHS-Dimension 最低計費重(**只套 Dimension**,Weight 和 Packaging 沒有下限)
- AHS / LPS 門檻判定
- 35 個收費代碼,含 17 種附加費(`AHB` / `AHD` 排除,你確認過 37 期都沒出現)
- 宣告價值級距(超過免費上限全額計費、含第一單位)
- 燃油,可按渠道設不同期間
- 跨期 ADJ/SCC 依歷史判定住宅或商業

**尚未移植**(畫面上會標出來,不會填 0):跨期 SCC 在附加費層級的 C−A 淨額。

### ADJ 的磅秤重量

AHS-Weight 與 LPS 的重量條用磅秤重量,不是計費重、也不是 SCC 更正後的重量。
ADJ 那一行的 Entered Weight 常常是被 DIM 撐大的更正後計費重(41 lb 的件在
ADJ 上可能寫 95),拿它去比 50 lb 門檻會誤觸發,所以:

- 同一個追蹤號只要有 SHP / RTN,一律用它們的 Entered;Entered 為 0(退貨常
  見)時用它們的 Billed。
- 完全查不到原出貨的純 ADJ,只剩自己那一欄可用。
- 純 ADJ 且 Billed Weight Type = 9(材積重主導)時,兩欄都是材積驅動的計費
  重,沒有可信的磅秤重量,重量那兩條一律不觸發,交給尺寸判定。

Billed Weight Type 取同一組的最後一個非空值,SCC 重新定基(8)會蓋掉原出貨
的 3 / 9。沒有標題列的 CSV 從第 31 欄讀,和桌面版同一個位置。

### Not Previously Billed(CLB)

CLB 是 UPS 當時漏開、事後補收的**第二段運送**,有自己的重量、尺寸與 Zone;
SCC 則是同一件重新計價。兩者在帳單上都是 ADJ 層,靠 Charge Category Detail
Code 分辨。

- 同一個追蹤號上有原出貨(SHP / RTN)時,CLB 拆成獨立的一段各自計價,金額
  加進總額但欄位分開列。把第二段的運費印在第一段的計費重旁邊,是一列自相
  矛盾的資料。
- 原出貨不在這張帳單裡時,CLB 本身就是這一筆,照一般欄位算。
- UPS 實收金額仍然包含兩段,所以差異欄照樣對得起來。

非 ADJ 層的 Entered Weight 為 0 時(退貨常把重量只寫在 Billed 欄),用
Billed 當重量,不然計費重會掉到材積重、運費算低。

### AHS 最低計費重的兩條路

- **我們自己依門檻判定的**:Billed Weight Type 8(SCC 重新定基)與 9(材積重
  主導)時不套下限,UPS 在這兩種情況下也不會把計費重拉上去。
- **UPS 自己開過 AHS - Dimension 代碼的**:不受 type 限制。UPS 判過之後,就算
  事後用 SCC 把附加費沖掉,被拉高的計費重也不會退回去 —— 照自己合約的下限算,
  否則同一顆箱子收得比成本低,差額自己吸收。

哪些代碼算 AHS - Dimension,讀 🔎 代碼查詢那一頁維護的登錄表(目前是
AHG / AHL / AHS / AHV),不在程式裡另開名單。

### 跨期更正的 C − A 差額

跨期更正單同時帶著 `Package Dimensions`(C,更正後)與 `Detail Keyed
Dimensions`(A,原始)時,UPS 收的是差額。兩個包裹各自算一次計費重與運費再
相減,A 用原出貨的服務別。只算 C 會把原本已經收過的那一段再收一次。

只有一組尺寸、或同一張帳單裡就有原出貨(不是跨期)時,不做差額,行為不變。
A 的費率查不到時不硬扣,照 C 收並在 issue 欄標明。

### Demand(旺季附加費)

已接進計價,不再只是一張表單。規則照桌面版 `calc_demand_surcharge()`:

- 期間看**出貨日**,不是發票日 —— 出貨在期間之前的件,不會因為帳單晚寄就變成
  要收。
- 特殊處理一件只收一項,**OVR > LPS > AHS**;有 GROUP 的列優先於空白的。
- 服務級距的分組**不從名字猜**,只認 Demand 分頁裡設的對照。對照成空字串是
  「這條線不收服務級距」,和「沒設定」不一樣。
- 只有帶運費的那一層收 —— 純附加費的 ADJ 不是第二件包裹。
- UPS 對 Demand 也收燃油,所以它進燃油底。

Demand 分頁的開關關著、或一列都沒設時完全不啟動,不會在報表上留一個「收了但
是 0」的欄位。

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
