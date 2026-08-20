# -*- coding: utf-8 -*-
"""
git history audit -- what has EVER been committed, not what is there now.

Put this in the repo root and run:

    python audit_git.py

Read-only. It does not change the repository.

Output is deliberately ASCII-only: a Traditional Chinese Windows console
runs on cp950, and printing CJK there raises UnicodeEncodeError on some
setups. The full list is also written to git_audit_report.txt in UTF-8.
"""

import os
import re
import subprocess
import sys

REPORT = "git_audit_report.txt"

# Files that must never be in this repository.
SENSITIVE = [
    (re.compile(r"ups_billing_tool_config\.json$"),
     "CLIENT CONTRACT RATES -- 1500 negotiated base rates, 56 accessorial rates"),
    (re.compile(r"ups_history\.sqlite3"),
     "INVOICE HISTORY -- 104k billing lines, 12.5k tracking numbers"),
    (re.compile(r"\.(xlsx|xls|csv)$", re.I),
     "invoice or report file"),
]
# The sample config is the sanitised one -- it is fine.
SAFE = re.compile(r"sample", re.I)

TOKEN_RE = re.compile(r"gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}")
# Identifiers are matched by SHAPE, not by value. Hard-coding an account
# number into an audit script means the script itself leaks it the moment
# it lands in a public repository.
IDENT_PATTERNS = [
    (re.compile(r"\b1Z[0-9A-Z]{16}\b"),                "UPS tracking number"),
    (re.compile(r"\b0{4,6}[0-9A-F]{6}\d{2,3}\b"),      "UPS account / invoice number"),
    (re.compile(r"[A-Za-z]:[\\/]Users[\\/][^\\/\s\"']+"), "local Windows user path"),
]


def ident_hit(text):
    """First identifier shape found in this text, or None."""
    for pat, what in IDENT_PATTERNS:
        if pat.search(text):
            return what
    return None

out_lines = []


def say(s=""):
    """Print ASCII-safe, remember everything for the UTF-8 report."""
    out_lines.append(s)
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode("ascii"))


def git(*args):
    try:
        r = subprocess.run(["git"] + list(args),
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        return r.stdout
    except FileNotFoundError:
        say("ERROR: git not found on PATH.")
        sys.exit(1)


def header(t):
    say("")
    say("=" * 66)
    say("  " + t)
    say("=" * 66)


def find_repo():
    """Locate the repository root.

    Double-clicking a .py can leave the working directory pointing at the
    Python installation instead of the script's folder, so cwd is not
    trustworthy. Start from where this file actually sits, walk upwards,
    and only then ask.
    """
    try:
        start = os.path.dirname(os.path.abspath(__file__))
    except NameError:
        start = os.getcwd()

    for base in (start, os.getcwd()):
        d = base
        while True:
            if os.path.isdir(os.path.join(d, ".git")):
                return d
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent

    print("No .git found near this script.")
    print("")
    print("If the repository is somewhere else, drag its folder onto this")
    print("window and press Enter. Leave blank and press Enter to quit.")
    print("")
    print("If you have no local copy at all -- the repository was created")
    print("on the GitHub website -- then nothing from this machine was ever")
    print("committed. Check the file list on the repo page instead.")
    while True:
        try:
            raw = input("repo folder> ").strip().strip('"').strip("'")
        except EOFError:
            return None
        if not raw:
            return None
        if os.path.isdir(os.path.join(raw, ".git")):
            return raw
        print("  Not a repository (no .git inside): %s" % raw)


def main():
    repo = find_repo()
    if not repo:
        return
    os.chdir(repo)
    say("Repository: %s" % repo)

    header("REMOTE AND SIZE")
    say(git("remote", "-v").strip() or "  (no remote)")
    n = git("rev-list", "--all", "--count").strip()
    say("  commits: %s" % (n or "0"))
    br = git("branch", "-a").strip()
    say("  branches:")
    for line in br.splitlines():
        say("    " + line.strip())

    header("CURRENTLY TRACKED FILES")
    tracked = [f for f in git("ls-files").splitlines() if f.strip()]
    for f in tracked:
        say("  " + f)
    if not tracked:
        say("  (none)")

    # This is the part that matters. Deleting a file in a later commit
    # does not remove it from history -- it is still fetchable.
    header("EVERY FILE THAT HAS EVER BEEN COMMITTED")
    hist = set()
    for line in git("log", "--all", "--pretty=format:",
                    "--name-only").splitlines():
        line = line.strip()
        if line:
            hist.add(line)
    for f in sorted(hist):
        mark = "  " if f in tracked else " *"   # * = deleted but still in history
        say("%s %s" % (mark, f))
    if not hist:
        say("  (none)")
    say("")
    say("  * = not in the working tree any more, but still in history.")

    header("SENSITIVE FILE CHECK")
    hits = []
    for f in sorted(hist):
        if SAFE.search(f):
            continue
        for pat, why in SENSITIVE:
            if pat.search(f):
                commits = len([x for x in git(
                    "log", "--all", "--oneline", "--", f).splitlines() if x])
                hits.append((f, why, commits))
                break
    if hits:
        for f, why, c in hits:
            say("  [EXPOSED] %s" % f)
            say("            %s" % why)
            say("            in %d commit(s)" % c)
    else:
        say("  No config, history database, or invoice file found in history.")

    header("SECRET AND IDENTIFIER SCAN (all commits)")
    revs = [r for r in git("rev-list", "--all").splitlines() if r.strip()]
    found = []
    for rev in revs:
        for path in git("ls-tree", "-r", "--name-only", rev).splitlines():
            path = path.strip()
            if not path:
                continue
            blob = git("show", "%s:%s" % (rev, path))
            if TOKEN_RE.search(blob):
                found.append((rev[:8], path, "GitHub token"))
            else:
                what = ident_hit(blob)
                if what:
                    found.append((rev[:8], path, what))
    seen = set()
    for rev, path, what in found:
        key = (path, what)
        if key in seen:
            continue
        seen.add(key)
        say("  [%s] %s  <- %s" % (rev, path, what))
    if not found:
        say("  Nothing found.")

    header("VERDICT")
    if hits:
        say("  Client data is in this repository's history.")
        say("  Making the repo private does NOT undo a public exposure.")
        say("  Cleanest fix for a young repo: DELETE the repository on")
        say("  GitHub and recreate it clean. Do not rewrite history --")
        say("  old objects stay reachable by SHA for a while.")
    elif found:
        say("  No data files, but identifiers or a token appear in file")
        say("  contents. Remove them and rotate anything credential-like.")
    else:
        say("  Nothing sensitive found in history.")

    with open(REPORT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out_lines))
    say("")
    say("Full report written to %s (UTF-8)." % REPORT)


if __name__ == "__main__":
    main()
    if os.name == "nt":
        try:
            input("\nPress Enter to close...")
        except EOFError:
            pass
