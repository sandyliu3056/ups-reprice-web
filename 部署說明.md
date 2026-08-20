# UPS Reprice Tool v170 — 一模一樣的部署

工具本身是可攜的:`_app_dir()` 把設定綁在程式檔旁邊,全檔沒有任何硬編絕對路徑。
所以「一模一樣」的難點不在 exe,在**跟著 exe 走的東西**。

---

## 一、必須一起走的三樣

放在同一個資料夾,exe 旁邊。少一樣,結果就不會一樣。

| 檔案 | 決定什麼 | 少了會怎樣 |
|---|---|---|
| `UPS_Reprice_Tool.exe` | 計價引擎 | — |
| `ups_billing_tool_config.json` | 費率、管道、附加費、AHS/LPS 門檻、code registry | 開起來是全新空白設定,**算出來的錢完全不一樣** |
| `ups_history.sqlite3` | 每一期匯入過的帳單明細 | 跨期 ADJ/SCC 查不到原始 shipment 的 FRT 描述,住宅/商業分類會錯 |

第二個是「金額不一樣」最常見的原因,第三個是「單期看起來對、跨期改單就錯」的原因。
兩個都不是選配。

---

## 二、字型:裝了才是同一張臉

字型只影響外觀,**不影響任何金額**。沒裝不會壞,只是掉回正黑體。

要一模一樣,目標機要裝:

- `RepriceSketch.ttf` — 標題和分頁的手繪字
- `Iansui` 或 `芫荽` — 中文手寫層
- `LXGW WenKai TC`(霞鶩文楷)— 內文的可讀退路

裝法:對 `.ttf` 按右鍵 → 為所有使用者安裝。裝完要重開工具。

### 免安裝的做法

同事電腦沒有安裝權限的話,可以在啟動時私有註冊字型 —— 只有這個 process 看得到,
不會動到系統字型清單。在 `pick_display_font()` 之前(約第 308 行)加:

```python
def _load_bundled_fonts():
    """把 exe 旁邊的 .ttf 私有註冊給這個 process。

    只影響外觀。註冊失敗就當作沒裝,一路走既有的 fallback。
    """
    if os.name != "nt":
        return
    import ctypes
    FR_PRIVATE = 0x10
    for name in ("RepriceSketch.ttf",):
        path = os.path.join(_app_dir(), name)
        if not os.path.exists(path):
            continue
        try:
            n = ctypes.windll.gdi32.AddFontResourceExW(
                ctypes.c_wchar_p(path), FR_PRIVATE, 0)
            print("字型 %s:%s" % (name, "載入" if n else "系統不接受"))
        except Exception as e:
            print("字型 %s 載入失敗,用系統既有的:%s" % (name, e))
```

呼叫點在建好 `root` 之後、`resolve_round_font(root)` 之前。
順序很重要:Tk 是在建 root 時抓字型清單的。

---

## 三、版本鎖定

不同 pandas 大版本對 `read_excel` 的 dtype 推斷不一樣,同一張 invoice 可能被讀成不同型別。
要真正重現,在**現在跑得起來的那台**下:

```
pip freeze > requirements.lock.txt
```

新機器用這個檔裝,不要用 `requirements.txt`。

---

## 四、打包

把這四個檔案放進 `UPS_Reprice_Tool.py` 的資料夾:

```
UPS_Reprice_Tool.py
UPS_Reprice_Tool.spec
build.bat
requirements.txt
verify_deploy.py
ups_billing_tool_config.json      ← 你現在在用的那份
ups_history.sqlite3               ← 你現在在用的那份
RepriceSketch.ttf                 ← 有的話
```

雙擊 `build.bat`。產出在 `dist\UPS_Reprice_Tool\`。

**整個資料夾壓縮起來給同事,不要只給 exe。**
`_internal\` 裡是 pandas 和 numpy 的 DLL,抽掉 exe 就開不起來。

spec 預設是 onedir 不是 onefile:onefile 每次啟動都要把 pandas 解壓到 temp,
冷開機十幾秒;onedir 秒開,而且 PyInstaller 6 會把 DLL 全收進 `_internal\`,
最上層只留 exe —— 剛好對上 `_app_dir()` 的設計,config 和 history 就在同事看得到的地方。

---

## 五、驗收

### 1. 兩台各跑一次

```
python verify_deploy.py
```

比對:config 的 sha256、各項筆數、history 的列數。全一樣 = 設定一致。

### 2. 跑同一張 invoice

這才是真的驗完。同一個檔案兩台各跑一次,對三件事:

- 總金額
- `<report>_rate_issues.csv` 兩邊都是空的
- 標題列都顯示 **v170**

第三點看起來多餘,但這支工具歷史上每一次「我改了但沒變」都是舊檔還在跑。

---

## 六、之後怎麼維持一致

同事各自本機跑、靠匯出匯入同步歷史,所以**不要**讓大家各自改設定。
`ups_billing_tool_config.json` 以你這份為準,改動後重發,同事整份覆蓋。

要換版本時:

1. 你這台先跑 `verify_deploy.py`,把輸出存檔
2. 重新 build,把新的 exe + 你的 config 一起發
3. 同事覆蓋整個資料夾,但**保留自己的 `ups_history.sqlite3`**(那是他們匯入過的帳單)
4. 同事跑一次 `verify_deploy.py`,config 的 sha256 要跟你的一樣

第 3 點是唯一一個「不要覆蓋」的檔案,值得在發布訊息裡寫清楚。
