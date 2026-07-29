"""UPS Reprice -- web edition.

Runs the same engine as the desktop tool. Nothing about how a shipment is
rated lives in this file; it only collects files and settings, hands them
over, and offers the results for download.

    pip install streamlit pandas openpyxl
    streamlit run app.py
"""

import os
import tempfile
import traceback

import pandas as pd
import streamlit as st

from engine import Engine, save_upload

st.set_page_config(page_title="UPS Reprice", page_icon="📦", layout="wide")

ACCENT = "#a9743f"
st.markdown(f"""
<style>
  .stApp header {{background: transparent;}}
  h1, h2, h3 {{color:#351C15;}}
  div.stButton > button[kind="primary"] {{
      background:{ACCENT}; border:0; padding:.6rem 1.4rem; font-weight:600;}}
  .note {{color:#6B4F3A; font-size:.85rem;}}
</style>""", unsafe_allow_html=True)

st.title("📦 UPS Reprice")
st.markdown('<p class="note">Same rating engine as the desktop tool. '
            'Nothing is stored: files live only for this session.</p>',
            unsafe_allow_html=True)


def workdir():
    if "dir" not in st.session_state:
        st.session_state["dir"] = tempfile.mkdtemp(prefix="ups_web_")
    return st.session_state["dir"]


# ---------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------
with st.sidebar:
    st.header("Rating rules")
    dim = st.text_input("DIM factor", "300")
    service = st.selectbox("Service for unrecognised descriptions", [
        "Ground Commercial", "Ground Residential", "SurePost", "3 Day Select",
        "2nd Day Air", "2nd Day Air AM", "Next Day Air Saver", "Next Day Air",
        "Next Day Air Early", "Standard", "Worldwide Expedited",
        "Worldwide Saver", "Worldwide Express", "Worldwide Express Plus",
        "Worldwide Economy"])
    fuel = st.text_input("Fuel %", "18.75")

    st.subheader("Minimum billable weight")
    ahs_min = st.text_input("AHS", "15")
    lps_min = st.text_input("Large package", "90")
    st.caption("15 for AHS, not 40 — verified against invoice "
               "000000174C7E306.")

    with st.expander("Thresholds"):
        c1, c2 = st.columns(2)
        ahs_side = c1.text_input("AHS longest side", "48")
        ahs_2nd = c2.text_input("AHS 2nd side", "30")
        ahs_lg = c1.text_input("AHS L+G", "105")
        ahs_cu = c2.text_input("AHS cubic", "10368")
        lps_side = c1.text_input("LPS longest side", "96")
        lps_lg = c2.text_input("LPS L+G", "130")
        lps_cu = c1.text_input("LPS cubic", "17280")
        lps_wt = c2.text_input("LPS weight", "110")

SETTINGS = {
    "dim_factor": dim, "base_rate_service": service, "fuel_percent": fuel,
    "ahs_min_billable_weight": ahs_min,
    "oversize_min_billable_weight": lps_min,
    "ahs_longest_side": ahs_side, "ahs_second_side": ahs_2nd,
    "ahs_lg_limit": ahs_lg, "ahs_cubic_inches": ahs_cu,
    "oversize_longest_side": lps_side, "oversize_length_girth": lps_lg,
    "oversize_cubic_inches": lps_cu, "oversize_actual_weight": lps_wt,
}

# ---------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------
left, right = st.columns(2)
with left:
    st.subheader("1  UPS invoice")
    invoice = st.file_uploader("xlsx / xls / csv", type=["xlsx", "xls", "csv"],
                               key="inv")
    st.caption("A headerless CSV export is fine — it is detected.")
with right:
    st.subheader("2  Base rate table")
    rates = st.file_uploader("One file per service, or several at once",
                             type=["xlsx", "xls"], accept_multiple_files=True,
                             key="rates")

if invoice and rates:
    st.divider()
    go = st.button("Reprice", type="primary")

    if go:
        d = workdir()
        try:
            with st.status("Working…", expanded=True) as status:
                st.write("Saving uploads")
                inv_path = save_upload(invoice, d)
                rate_paths = [save_upload(r, d) for r in rates]

                st.write("Loading rate tables")
                eng = Engine(SETTINGS)
                loaded = eng.load_rates(rate_paths)
                st.write(f"Services: {', '.join(loaded) or 'none'}")
                if not loaded:
                    raise RuntimeError(
                        "No rate table was recognised in those files.")

                st.write("Repricing — a large invoice takes a few minutes")
                out = os.path.join(d, "client_report.xlsx")
                eng.reprice(inv_path, out)

                st.write("Building the internal statement")
                stmt = os.path.join(d, "statement.xlsx")
                try:
                    eng.statement(out, inv_path, stmt)
                except Exception as e:            # statement is optional
                    stmt = None
                    st.write(f"Statement skipped: {e}")

                status.update(label="Done", state="complete", expanded=False)

            st.session_state["out"] = out
            st.session_state["stmt"] = stmt
            st.session_state["log"] = eng.log
        except Exception as e:
            st.error(f"{type(e).__name__}: {e}")
            with st.expander("Detail"):
                st.code(traceback.format_exc())

# ---------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------
out = st.session_state.get("out")
if out and os.path.exists(out):
    st.divider()
    detail = pd.read_excel(out, sheet_name="Shipment Detail")
    total = pd.to_numeric(detail.get("Total"), errors="coerce").fillna(0).sum()

    a, b, c = st.columns(3)
    a.metric("Packages", f"{len(detail):,}")
    b.metric("Billed to client", f"${total:,.2f}")

    stmt = st.session_state.get("stmt")
    if stmt and os.path.exists(stmt):
        ov = pd.read_excel(stmt, sheet_name="Overview")
        cost = pd.to_numeric(ov.get("UPS"), errors="coerce").fillna(0).sum()
        c.metric("Profit", f"${total - cost:,.2f}",
                 f"{(total - cost) / total * 100:.1f}%" if total else "—")

    st.subheader("Downloads")
    d1, d2 = st.columns(2)
    with open(out, "rb") as f:
        d1.download_button("Client report", f, "client_report.xlsx",
                           type="primary", use_container_width=True)
    d1.caption("Goes to the client. No cost, no margin.")
    if stmt and os.path.exists(stmt):
        with open(stmt, "rb") as f:
            d2.download_button("Weekly statement (internal)", f,
                               "statement.xlsx", use_container_width=True)
        d2.caption("Cost, profit and margin. Keep this one.")

    with st.expander(f"Preview — first 50 of {len(detail):,} rows"):
        st.dataframe(detail.head(50), use_container_width=True)

    log = st.session_state.get("log") or []
    if log:
        with st.expander("Engine messages"):
            for line in log[-40:]:
                st.text(line)
elif not (invoice and rates):
    st.info("Upload an invoice and at least one rate table to begin.")
