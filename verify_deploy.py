# -*- coding: utf-8 -*-
"""
UPS Reprice Tool -- 部署對照
=============================================================
在來源機和目標機各跑一次,兩邊輸出逐行對照。
一樣 = 這台算出來的錢會跟那台一樣。

    python verify_deploy.py

沒有參數。它只讀不寫,不會動到任何設定。
"""

import os
import sys
import json
import hashlib
import sqlite3

CONFIG = "ups_billing_tool_config.json"
HISTORY = "ups_history.sqlite3"

# 這幾隻裝了介面才會是手繪的樣子。沒裝不會壞,只是掉回正黑體。
FONTS_WANTED = [
    "Reprice Sketch",
    "Iansui", "芫荽",
    "LXGW WenKai TC", "霞鶩文楷 TC",
    "Ink Free", "Segoe Print",
    "Microsoft JhengHei UI",     # Windows 內建,當保底
]


def line(title):
    print("\n" + title)
    print("-" * 58)


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def check_env():
    line("環境")
    print("  Python      %s" % sys.version.split()[0])
    print("  執行位置    %s" % os.path.abspath("."))
    for mod in ("pandas", "numpy", "customtkinter", "openpyxl", "tzdata"):
        try:
            m = __import__(mod)
            print("  %-13s %s" % (mod, getattr(m, "__version__", "(無版本號)")))
        except ImportError:
            note = " <-- 少了這個跑不起來" if mod != "tzdata" else " <-- 時區會用固定時差"
            print("  %-13s 沒有裝%s" % (mod, note))


def check_config():
    line("設定檔  " + CONFIG)
    if not os.path.exists(CONFIG):
        print("  沒有這個檔案。")
        print("  -> 工具會用內建預設值開起來,費率全部是空的。")
        print("  -> 這是「算出來的錢不一樣」最常見的原因。")
        return
    print("  sha256      %s" % sha(CONFIG))
    print("  大小        %s bytes" % os.path.getsize(CONFIG))
    try:
        cfg = json.load(open(CONFIG, encoding="utf-8"))
    except Exception as e:
        print("  [X] 讀不動:%s" % e)
        return

    # 影響金額的幾組東西,各報一個數量,方便一眼看出少了哪塊
    for key, label in (
        ("channels", "管道"),
        ("ahs_lps_code_registry", "AHS/LPS code registry"),
        ("surcharges", "附加費"),
        ("fuel_schedule", "燃油級距"),
        ("demand_periods", "旺季附加費期間"),
    ):
        v = cfg.get(key)
        if v is None:
            print("  %-24s (沒有這個欄位)" % label)
        elif isinstance(v, (dict, list)):
            print("  %-24s %d 筆" % (label, len(v)))
        else:
            print("  %-24s %s" % (label, v))

    ch = cfg.get("channels")
    if isinstance(ch, dict) and ch:
        names = sorted(ch.keys())
        print("  管道名稱    %s" % ", ".join(names[:8]))
        if len(names) > 8:
            print("              ...另外 %d 個" % (len(names) - 8))


def check_history():
    line("歷史檔  " + HISTORY)
    if not os.path.exists(HISTORY):
        print("  沒有這個檔案。")
        print("  -> 跨期 ADJ/SCC 查不到原始 shipment 的 FRT 描述,")
        print("     住宅/商業會分類錯。這個檔要跟著走。")
        return
    print("  大小        %s bytes" % os.path.getsize(HISTORY))
    try:
        con = sqlite3.connect("file:%s?mode=ro" % HISTORY, uri=True)
        cur = con.cursor()
        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        print("  資料表      %s" % (", ".join(tables) or "(空的)"))
        for t in tables:
            try:
                n = cur.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
                print("    %-22s %8d 列" % (t, n))
            except Exception:
                pass
        con.close()
    except Exception as e:
        print("  [X] 打不開:%s" % e)


def check_fonts():
    line("字型  (只影響外觀,不影響金額)")
    try:
        import tkinter as tk
        from tkinter import font as tkfont
        root = tk.Tk()
        root.withdraw()
        have = {f.strip() for f in tkfont.families(root)}
        root.destroy()
    except Exception as e:
        print("  查不到:%s" % e)
        return
    for name in FONTS_WANTED:
        print("  [%s] %s" % ("v" if name in have else " ", name))
    if not any(n in have for n in ("Iansui", "芫荽", "LXGW WenKai TC", "霞鶩文楷 TC")):
        print("\n  中文手寫/文楷一隻都沒裝 -> 介面會是正黑體。")
        print("  功能完全正常,只是看起來不是手繪的那一版。")


def main():
    print("=" * 58)
    print(" UPS Reprice Tool  部署對照")
    print("=" * 58)
    check_env()
    check_config()
    check_history()
    check_fonts()
    print("\n" + "=" * 58)
    print(" 兩台的 sha256 和各項筆數都一樣 = 設定一致。")
    print(" 最後再跑同一張 invoice 對總金額,那才是真的驗完。")
    print("=" * 58)


if __name__ == "__main__":
    main()
    if os.name == "nt":
        input("\n按 Enter 關閉...")
