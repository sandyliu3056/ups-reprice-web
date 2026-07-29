"""Runs UPS_Reprice_Tool.py without a window.

The desktop tool is ~6,500 lines, of which ~4,700 are the rating engine and
only ~1,150 are tkinter. The engine never touches the window: run_repricing
contains no filedialog, no messagebox, no self.root. Its only ties to the GUI
are the tkinter variables it reads settings from, one Treeview it clears, and
the save dialog at the end.

So this module does not reimplement anything. It swaps those three things for
plain objects and calls the same code the desktop tool calls. Every fix that
lands in the desktop file is live here the moment it is copied in -- there is
no second copy of the rating rules to keep in step, which is the usual way a
"web version" quietly starts giving different numbers.
"""

from __future__ import annotations

import importlib.util
import os
import re
import sys
import tempfile
from pathlib import Path

TOOL = Path(__file__).with_name("UPS_Reprice_Tool.py")


# ---------------------------------------------------------------------
# Stand-ins for the parts of tkinter the engine touches
# ---------------------------------------------------------------------
class Var:
    """What the engine actually uses of a tkinter variable."""

    def __init__(self, value=""):
        self._v = value

    def get(self):
        return self._v

    def set(self, v):
        self._v = v

    def trace_add(self, *_a, **_k):
        return "trace0"

    def trace_remove(self, *_a, **_k):
        pass


class NullTree:
    """The preview Treeview. The engine clears it and fills it; nothing here
    reads it back, so the rows go nowhere."""

    def delete(self, *_a, **_k):
        pass

    def get_children(self, *_a, **_k):
        return ()

    def insert(self, *_a, **_k):
        pass

    def configure(self, *_a, **_k):
        pass

    heading = column = configure


def load_tool():
    """Import the desktop file. tkinter is imported at its top level but no
    window is created, so this works on a headless server."""
    spec = importlib.util.spec_from_file_location("ups_reprice_tool", TOOL)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ups_reprice_tool"] = mod
    spec.loader.exec_module(mod)
    return mod


def _defaults_from_source(obj, src):
    """Recreate every tk.*Var the real __init__ would have made, as plain
    values. Reading them out of the source keeps this in step automatically
    when a setting is added to the desktop tool."""
    for name, default in re.findall(
            r"self\.(\w+)\s*=\s*tk\.\w+Var\(value=([^)]*)\)", src):
        try:
            value = eval(default, {"__builtins__": {}}, {})
        except Exception:
            value = ""
        setattr(obj, name, Var(value))
    for name in re.findall(r"self\.(\w+)\s*=\s*tk\.\w+Var\(\)", src):
        if not hasattr(obj, name):
            setattr(obj, name, Var(""))


class Engine:
    """The desktop tool with the window taken off."""

    def __init__(self, settings: dict | None = None):
        self.mod = load_tool()
        cls = self.mod.UPSRepricingTool
        self.app = cls.__new__(cls)          # skip __init__: it builds the UI

        _defaults_from_source(self.app, TOOL.read_text(encoding="utf-8"))

        a = self.app
        a.rate_tables = {}
        a.fuel_schedule = []
        a.accessorial_rate_table = {}
        a.dynamic_surcharge_mapping = dict(
            self.mod.DEFAULT_DYNAMIC_SURCHARGE_MAPPING)
        a.dynamic_surcharge_code_map = {}
        a.ahs_lps_code_registry = {}
        a.base_rate_diagnostics = []
        a.warning_logs = []
        a.last_report_path = ""
        a.preview = NullTree()

        # Anything that would have talked to the window becomes a no-op, and
        # errors are raised instead of shown in a dialog nobody can click.
        a.set_status = lambda text: self.log.append(str(text))
        a.confirm = lambda *x, **k: None
        a.save_config = lambda *x, **k: None
        a.load_config = lambda *x, **k: None

        self.log: list[str] = []
        for key, value in (settings or {}).items():
            if hasattr(a, key):
                getattr(a, key).set(value)

    # -- inputs --------------------------------------------------------
    def load_rates(self, paths):
        """Same importer the desktop Import Base Rate button uses, so a rate
        workbook that works in one works in the other."""
        self.app._load_base_rate_files([str(p) for p in paths], quiet=True)
        return sorted(self.app.rate_tables.keys())

    def set_fuel(self, schedule):
        self.app.fuel_schedule = list(schedule or [])

    def set_acc_rates(self, table):
        self.app.accessorial_rate_table = dict(table or {})

    # -- run -----------------------------------------------------------
    def reprice(self, invoice_path, out_path):
        """Produce the client report. Returns the path written."""
        self.app.billing_path.set(str(invoice_path))

        # The engine ends by asking where to save. Answer without a dialog.
        fd = self.mod.filedialog
        original = fd.asksaveasfilename
        fd.asksaveasfilename = lambda *a, **k: str(out_path)

        # Turn the error dialog into a real exception.
        mb = self.mod.messagebox
        errors: list[str] = []
        keep = (mb.showerror, mb.showwarning, mb.showinfo)
        mb.showerror = lambda title, msg=None, **k: errors.append(
            f"{title}: {msg}")
        mb.showwarning = lambda title, msg=None, **k: self.log.append(
            f"{title}: {msg}")
        mb.showinfo = lambda *a, **k: None
        try:
            self.app.run_repricing()
        finally:
            fd.asksaveasfilename = original
            mb.showerror, mb.showwarning, mb.showinfo = keep

        if errors:
            raise RuntimeError(errors[0])
        if not os.path.exists(out_path):
            raise RuntimeError(
                "The engine finished without writing a report. "
                + (self.log[-1] if self.log else "No further detail."))
        return str(out_path)

    def statement(self, report_path, invoice_path, out_path):
        """Internal weekly statement: the client report joined back to the
        invoice for cost."""
        fd = self.mod.filedialog
        original = fd.asksaveasfilename
        fd.asksaveasfilename = lambda *a, **k: str(out_path)
        try:
            self.app._build_profit_report(str(report_path), str(invoice_path))
        finally:
            fd.asksaveasfilename = original
        if not os.path.exists(out_path):
            raise RuntimeError("No statement was written.")
        return str(out_path)

    # -- diagnostics ----------------------------------------------------
    def unpriced_codes(self, invoice_path):
        _by, _acct, _rows, unknown = self.app.ups_cost_by_tracking(
            str(invoice_path))
        return unknown


def save_upload(uploaded, folder=None) -> str:
    """Streamlit hands over an in-memory file; the engine wants a path."""
    folder = folder or tempfile.mkdtemp(prefix="ups_")
    dest = os.path.join(folder, os.path.basename(uploaded.name))
    with open(dest, "wb") as f:
        f.write(uploaded.getbuffer())
    return dest
