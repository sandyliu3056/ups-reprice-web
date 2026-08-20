# -*- coding: utf-8 -*-
"""
Find my files -- where are the real config and history, and is there a repo?

    python find_my_files.py

Read-only. It opens files to look at them and never writes to them.
Console output is ASCII-safe (cp950 consoles choke on some characters);
the full result is written to find_report.txt in UTF-8.

Answers two questions:
  1. Where is every copy of ups_billing_tool_config.json and
     ups_history.sqlite3 on this machine, and which one has the real data?
  2. Is there any git repository here, and does it contain client data?
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import time

REPORT = "find_report.txt"

TARGET_NAMES = {"ups_billing_tool_config.json", "ups_history.sqlite3"}

# Folders that never contain anything we want and cost minutes to walk.
SKIP_DIRS = {
    "node_modules", "__pycache__", ".venv", "venv", "env",
    "$Recycle.Bin", "Windows", "Program Files", "Program Files (x86)",
    "ProgramData", "AppData", ".git", "dist", "build", "site-packages",
}

TOKEN_RE = re.compile(r"gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}")

out = []


def say(s=""):
    out.append(s)
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode("ascii"))


def header(t):
    say("")
    say("=" * 68)
    say("  " + t)
    say("=" * 68)


def roots():
    """Where to look. User profile first -- OneDrive and Desktop live there."""
    found = []
    home = os.path.expanduser("~")
    if os.path.isdir(home):
        found.append(home)
    # OneDrive can be redirected outside the profile.
    for var in ("OneDrive", "OneDriveCommercial", "OneDriveConsumer"):
        p = os.environ.get(var)
        if p and os.path.isdir(p) and not any(
                os.path.normcase(p).startswith(os.path.normcase(f))
                for f in found):
            found.append(p)
    return found


def walk(root):
    """Yield (dirpath, filenames), pruning folders that waste time."""
    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        yield dirpath, dirnames, filenames


def when(path):
    try:
        return time.strftime("%Y-%m-%d %H:%M",
                             time.localtime(os.path.getmtime(path)))
    except OSError:
        return "?"


def look_at_config(path):
    """How much real rate data is in this config?"""
    try:
        cfg = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        return "unreadable (%s)" % e, False
    tables = cfg.get("base_rate_tables") or []
    rows = sum(len(t.get("rows") or []) for t in tables
               if isinstance(t, dict))
    acc = cfg.get("accessorial_rate_table") or {}
    has_paths = bool(str(cfg.get("billing_path") or "").strip())
    real = rows > 0
    bits = ["%d rate table(s), %d rate row(s)" % (len(tables), rows),
            "%d accessorial entries" % len(acc)]
    if has_paths:
        bits.append("contains local file paths")
    return "; ".join(bits), real


def look_at_history(path):
    """How many invoice lines are in this database?"""
    try:
        con = sqlite3.connect("file:%s?mode=ro" %
                              path.replace("?", "%3f"), uri=True)
        cur = con.cursor()
        try:
            n = cur.execute("SELECT COUNT(*) FROM invoice_rows").fetchone()[0]
        except sqlite3.Error:
            con.close()
            return "no invoice_rows table", False
        inv = cur.execute(
            "SELECT COUNT(DISTINCT invoice_number) FROM invoice_rows"
        ).fetchone()[0]
        rng = cur.execute(
            "SELECT MIN(invoice_date), MAX(invoice_date) FROM invoice_rows"
        ).fetchone()
        con.close()
        if n == 0:
            return "EMPTY -- 0 rows", False
        return ("%d rows, %d invoices, %s to %s"
                % (n, inv, rng[0], rng[1])), True
    except Exception as e:
        return "unreadable (%s)" % e, False


def git(repo, *args):
    try:
        r = subprocess.run(["git", "-C", repo] + list(args),
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        return r.stdout
    except FileNotFoundError:
        return ""


def main():
    say("Scanning. This takes a minute or two.")
    say("")

    configs, histories, repos = [], [], []
    scanned = 0
    for root in roots():
        say("  looking under: %s" % root)
        for dirpath, dirnames, filenames in walk(root):
            scanned += 1
            # Check the folder itself, not dirnames -- walk() prunes ".git"
            # out of dirnames before this line ever runs, so looking there
            # would never match.
            if os.path.isdir(os.path.join(dirpath, ".git")):
                repos.append(dirpath)
            for fn in filenames:
                if fn in TARGET_NAMES:
                    full = os.path.join(dirpath, fn)
                    if fn.endswith(".json"):
                        configs.append(full)
                    else:
                        histories.append(full)
    say("  folders scanned: %d" % scanned)

    # ---- config copies ------------------------------------------------
    header("ups_billing_tool_config.json  (%d copies)" % len(configs))
    real_cfg = []
    for p in sorted(configs):
        desc, real = look_at_config(p)
        tag = "[REAL DATA]" if real else "[empty    ]"
        if real:
            real_cfg.append(p)
        say("%s %s" % (tag, p))
        say("             %s bytes, modified %s"
            % (format(os.path.getsize(p), ","), when(p)))
        say("             %s" % desc)
    if not configs:
        say("  None found.")

    # ---- history copies ------------------------------------------------
    header("ups_history.sqlite3  (%d copies)" % len(histories))
    real_hist = []
    for p in sorted(histories):
        desc, real = look_at_history(p)
        tag = "[REAL DATA]" if real else "[empty    ]"
        if real:
            real_hist.append(p)
        say("%s %s" % (tag, p))
        say("             %s bytes, modified %s"
            % (format(os.path.getsize(p), ","), when(p)))
        say("             %s" % desc)
    if not histories:
        say("  None found.")

    # ---- git repositories ----------------------------------------------
    header("GIT REPOSITORIES  (%d found)" % len(repos))
    for repo in sorted(set(repos)):
        say("")
        say("  %s" % repo)
        remote = git(repo, "remote", "-v").strip()
        say("    remote : %s" % (remote.splitlines()[0] if remote
                                 else "(none)"))
        say("    commits: %s" % (git(repo, "rev-list", "--all",
                                     "--count").strip() or "0"))
        hist = set()
        for line in git(repo, "log", "--all", "--pretty=format:",
                        "--name-only").splitlines():
            line = line.strip()
            if line:
                hist.add(line)
        bad = [f for f in hist
               if ("sample" not in f.lower()) and
               (f.endswith("ups_billing_tool_config.json")
                or "ups_history.sqlite3" in f
                or f.lower().endswith((".xlsx", ".xls", ".csv")))]
        if bad:
            say("    !! CLIENT DATA IN HISTORY:")
            for f in sorted(bad):
                say("       %s" % f)
        else:
            say("    clean: no config, history db, or invoice file"
                " in its history")
    if not repos:
        say("  None. Nothing on this machine was ever committed to git.")

    # ---- verdict --------------------------------------------------------
    header("WHAT THIS MEANS")
    if real_hist:
        say("  Your real invoice history is safe. It is here:")
        for p in real_hist:
            say("    %s" % p)
    else:
        say("  !! No history database with data was found.")
        say("     Your files sit under OneDrive, which keeps versions:")
        say("     right-click the file -> Version history -> restore.")
    if real_cfg:
        say("")
        say("  Your real rate config is here:")
        for p in real_cfg:
            say("    %s" % p)
    else:
        say("")
        say("  !! No config with rate tables was found. Same OneDrive")
        say("     version history applies.")
    say("")
    if not repos:
        say("  No git repository exists on this machine, so nothing from")
        say("  here was ever pushed. If the GitHub repo was made on the")
        say("  website, it holds only what you created there.")

    with open(REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    say("")
    say("Full report written to %s (UTF-8), next to this script." % REPORT)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    if os.name == "nt":
        try:
            input("\nPress Enter to close...")
        except EOFError:
            pass
