# -*- coding: utf-8 -*-
"""
產生可以進 git 的樣本設定
=============================================================
從你在用的 ups_billing_tool_config.json 產出
ups_billing_tool_config.sample.json:

  保留  結構、管道名稱、代碼清單、欄位、UPS 公告門檻
  清掉  所有議價費率、附加費金額、DIM 除數、燃油百分比、
        本機路徑、使用者名稱

新機器拿樣本檔當起點,再把真的那份用內部管道傳過去。
樣本檔可以進 git,真的那份永遠不行。

    python make_sample_config.py

只讀原檔,不會改到它。
"""

import json
import os

SRC = "ups_billing_tool_config.json"
DST = "ups_billing_tool_config.sample.json"

# 這些是 UPS 公告的門檻,不是議價結果,留著新機器才知道欄位長怎樣。
PUBLIC_RULE_KEYS = {
    "use_oversize_longest", "use_oversize_weight", "use_oversize_cubic",
    "use_oversize_lg", "oversize_longest_side", "oversize_actual_weight",
    "oversize_cubic_inches", "oversize_length_girth",
    "oversize_min_billable_weight",
    "use_ahs_weight", "use_ahs_longest", "use_ahs_second", "use_ahs_cubic",
    "use_ahs_lg", "ahs_weight_threshold", "ahs_longest_side",
    "ahs_second_side", "ahs_cubic_inches", "ahs_lg_limit",
    "ahs_min_billable_weight", "default_dim_factor",
}

# 這兩個的預設值本來就是 300 / 18.75(程式第 4835、4841 行),
# 但只要你改過,改出來的就是議價結果。一律歸零比較保險。
NEGOTIATED_RULE_KEYS = {"dim_factor", "fuel_percent"}


def blank_number(v):
    """數字歸零,字串型的數字歸 '0',其他原樣。"""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return 0
    if isinstance(v, str):
        s = v.strip().replace(",", "").replace("$", "").replace("%", "")
        try:
            float(s)
            return "0"
        except ValueError:
            return v
    return v


def main():
    if not os.path.exists(SRC):
        print("找不到 %s -- 請在設定檔旁邊執行。" % SRC)
        return

    cfg = json.load(open(SRC, encoding="utf-8"))
    notes = []

    # ---- 路徑:一律清空 ---------------------------------------------
    for key in ("billing_path", "last_report_path"):
        if cfg.get(key):
            cfg[key] = ""
            notes.append("清空 %s(含使用者名稱與客戶發票檔名)" % key)
    if cfg.get("base_rate_paths"):
        cfg["base_rate_paths"] = [""] * len(cfg["base_rate_paths"])
        notes.append("清空 base_rate_paths %d 條" % len(cfg["base_rate_paths"]))

    # ---- 基本費率表:留結構,數字歸零 --------------------------------
    rows_cleared = 0
    for tbl in cfg.get("base_rate_tables") or []:
        cols = tbl.get("columns") or []
        keep = {"Service", "Weight", "Residential"}
        for row in tbl.get("rows") or []:
            rows_cleared += 1
            if isinstance(row, dict):
                for k in list(row):
                    if k not in keep:
                        row[k] = blank_number(row[k])
            elif isinstance(row, list):
                for i, c in enumerate(cols):
                    if i < len(row) and c not in keep:
                        row[i] = blank_number(row[i])
    if rows_cleared:
        notes.append("基本費率歸零 %d 列(欄位與重量級距保留)" % rows_cleared)

    # ---- 附加費率表 --------------------------------------------------
    art = cfg.get("accessorial_rate_table") or {}
    for k, v in art.items():
        if isinstance(v, dict):
            for kk in list(v):
                v[kk] = blank_number(v[kk])
        elif isinstance(v, list):
            art[k] = [blank_number(x) for x in v]
        else:
            art[k] = blank_number(v)
    if art:
        notes.append("附加費率歸零 %d 組(代碼與管道名稱保留)" % len(art))

    ac = cfg.get("accessorial_charges") or {}
    for k in list(ac):
        ac[k] = blank_number(ac[k])
    if ac:
        notes.append("accessorial_charges 歸零 %d 項" % len(ac))

    # ---- 燃油 --------------------------------------------------------
    if cfg.get("fuel_schedule"):
        cfg["fuel_schedule"] = []
        notes.append("清空 fuel_schedule")
    for ch, sched in (cfg.get("channel_fuel_schedules") or {}).items():
        if isinstance(sched, list):
            cfg["channel_fuel_schedules"][ch] = []
    for ch in (cfg.get("channel_fuel_percents") or {}):
        cfg["channel_fuel_percents"][ch] = 0

    # ---- 全域規則 ----------------------------------------------------
    gr = cfg.get("global_rules") or {}
    for k in list(gr):
        if k in NEGOTIATED_RULE_KEYS:
            gr[k] = 0
            notes.append("global_rules.%s 歸零(議價項目)" % k)
        elif k not in PUBLIC_RULE_KEYS:
            gr[k] = blank_number(gr[k])

    # ---- DIM 除數(每管道)-------------------------------------------
    for ch in (cfg.get("channel_dim_factors") or {}):
        cfg["channel_dim_factors"][ch] = 0
    for ch, ov in (cfg.get("channel_rule_overrides") or {}).items():
        if isinstance(ov, dict):
            for k in list(ov):
                if k in NEGOTIATED_RULE_KEYS:
                    ov[k] = 0

    # ---- 旺季附加費 --------------------------------------------------
    dc = cfg.get("demand_config")
    if isinstance(dc, dict):
        for k in list(dc):
            if isinstance(dc[k], list):
                dc[k] = []
            else:
                dc[k] = blank_number(dc[k])
        notes.append("清空 demand_config")

    cfg["_sample_note"] = (
        "SAMPLE ONLY -- 所有議價費率、附加費金額、DIM 除數、燃油百分比、"
        "本機路徑都已清空。這個檔案只用來說明結構,不能拿來計價。"
    )

    with open(DST, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    print("產出:%s  (%d bytes)\n" % (DST, os.path.getsize(DST)))
    for n in notes:
        print("  -", n)
    print("\n這個檔可以進 git。%s 永遠不行。" % SRC)


if __name__ == "__main__":
    main()
