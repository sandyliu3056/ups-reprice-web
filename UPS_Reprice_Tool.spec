# -*- mode: python ; coding: utf-8 -*-
# =====================================================================
# UPS Reprice Tool -- PyInstaller spec
# 放在 UPS_Reprice_Tool.py 旁邊,用 build.bat 或:
#     pyinstaller UPS_Reprice_Tool.spec --noconfirm
# =====================================================================
#
# onedir,不是 onefile。理由有兩個:
#   1. onefile 每次啟動都要把 pandas + numpy 解壓到 temp,冷開機十幾秒;
#      onedir 是秒開。
#   2. PyInstaller 6 之後 onedir 會把所有 DLL 收進 _internal\,
#      最上層只留 exe -- 剛好符合 _app_dir() 的設計:
#      config 和 history 就放在 exe 旁邊,同事看得到、拿得走。
#
# 要改回 onefile:把最下面的 COLLECT 換成註解裡那段。

import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

SCRIPT = "UPS_Reprice_Tool.py"

# 打包時要不要留黑色 console 視窗。
#   False -- 給同事的正式版
#   True  -- 自己除錯用,才看得到 "Display font: ..." 那些 print
DEBUG_CONSOLE = False

# ---------------------------------------------------------------------
# 資料檔
# ---------------------------------------------------------------------
datas = []

# customtkinter 的佈景 json 和 assets。少了這個 exe 一開就閃退,
# 而且錯誤訊息只會說找不到 theme 檔,不會說是打包漏了。
datas += collect_data_files("customtkinter")

# Windows 不內建 IANA 時區資料庫,zoneinfo 靠 tzdata 這包。
# 沒有的話 TZ_CHOICES 會掉到固定時差,夏令時間會差一小時。
try:
    datas += collect_data_files("tzdata")
except Exception:
    print("[spec] tzdata 沒裝 -- 時區會用固定時差,不跟日光節約。")

# 手繪字型跟著 exe 走(要搭配 部署說明.md 裡的私有註冊那段才會生效;
# 只是放進去、沒註冊的話 Tk 看不到它)。
for _f in ("RepriceSketch.ttf",):
    if os.path.exists(_f):
        datas.append((_f, "."))
    else:
        print("[spec] 找不到 %s -- 介面會掉回正黑體,功能不受影響。" % _f)

# ---------------------------------------------------------------------
# 隱藏 import
# ---------------------------------------------------------------------
hiddenimports = []
hiddenimports += collect_submodules("customtkinter")
hiddenimports += [
    "openpyxl",
    "openpyxl.styles",
    "openpyxl.cell._writer",   # 只在 to_excel 時才被 import,靜態分析抓不到
    "tzdata",
    "sqlite3",
]

# ---------------------------------------------------------------------
# 排除:純粹是為了體積,這支工具一個都沒用到
# ---------------------------------------------------------------------
excludes = [
    "matplotlib", "scipy", "IPython", "jupyter", "notebook",
    "PyQt5", "PyQt6", "PySide2", "PySide6", "wx",
    "pytest", "sphinx", "setuptools._distutils",
    "tkinter.test", "test", "lib2to3",
]

a = Analysis(
    [SCRIPT],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="UPS_Reprice_Tool",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX 關掉。壓縮過的 exe 被防毒誤判的機率高很多,
    # 而且壓壞 DLL 的症狀是隨機閃退,很難查。省下的容量不值得。
    upx=False,
    console=DEBUG_CONSOLE,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,          # 有 .ico 就填檔名
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="UPS_Reprice_Tool",
)

# ---- 要 onefile 的話,把上面 COLLECT 註解掉,改用這段 ----------------
# exe = EXE(
#     pyz, a.scripts, a.binaries, a.datas, [],
#     name="UPS_Reprice_Tool",
#     debug=False, strip=False, upx=False,
#     runtime_tmpdir=None,
#     console=DEBUG_CONSOLE,
# )
