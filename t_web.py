"""端到端：模擬使用者上傳兩個檔案並取得兩份報表。"""
import sys, os, tempfile, io
sys.path.insert(0,"/home/claude/work/ups_web")
from engine import Engine, save_upload
import pandas as pd
fails=[]
def ck(l,fn):
    try: fn(); print("PASS ",l)
    except Exception as e: print("FAIL ",l,":",type(e).__name__,e); fails.append(l)

class Upload:              # 模擬 streamlit 的上傳物件
    def __init__(self,p): self.name=os.path.basename(p); self._b=open(p,"rb").read()
    def getbuffer(self): return self._b

D=tempfile.mkdtemp()
INV="/mnt/user-data/uploads/Invoice_000000174C7E306_072526.xlsx"
inv=save_upload(Upload(INV), D)
rat=save_upload(Upload("/tmp/rates.xlsx"), D)

def upload_roundtrip():
    assert os.path.exists(inv) and os.path.getsize(inv)>1000
ck("上傳檔案落地", upload_roundtrip)

eng=Engine({"dim_factor":"300","ahs_min_billable_weight":"15",
            "base_rate_service":"Ground Commercial"})
def rates_load():
    svc=eng.load_rates([rat])
    assert "Ground Commercial" in svc, svc
ck("費率表載入", rates_load)

OUT=os.path.join(D,"rep.xlsx"); STM=os.path.join(D,"stm.xlsx")
def reprice():
    eng.reprice(inv, OUT)
    d=pd.read_excel(OUT, sheet_name="Shipment Detail")
    assert len(d)>700, len(d)
ck("重算產出客戶報表", reprice)

def client_report_is_clean():
    bk=pd.read_excel(OUT, sheet_name=None)
    assert list(bk)==["Shipment Detail"], list(bk)
    cols=set(bk["Shipment Detail"].columns)
    for banned in ("UPS Invoice Total","Profit","Margin %","Invoice Number"):
        assert banned not in cols, banned
ck("客戶報表乾淨（無成本/毛利/發票號）", client_report_is_clean)

def statement():
    eng.statement(OUT, inv, STM)
    bk=pd.read_excel(STM, sheet_name=None)
    assert "Overview" in bk and "Account Charges" in bk, list(bk)
    o=bk["Overview"]
    assert o["Invoice Number"].notna().all(), "有空白發票號的幽靈列"
    assert len(o)==1, len(o)
    print("      Overview:", o["Invoice Number"].tolist(),
          f"UPS {o['UPS'].iloc[0]:,.2f}")
ck("對帳單產出且無幽靈列", statement)

def same_numbers_as_desktop():
    """逐票成本必須與桌面版相同。"""
    by,acct,_,_=eng.app.ups_cost_by_tracking(inv)
    assert abs(float(by.loc["1Z174C7E0311451573","Net"])-26.88)<0.01
    assert abs(acct-456.74)<0.01
ck("與桌面版同一組數字", same_numbers_as_desktop)

def cost_reconciles_including_unmatched():
    """Overview 只涵蓋對得上的票；對不上的必須出現在 Account Charges，
    兩者相加要等於發票總額。少算成本會虛增利潤。"""
    by,acct,_,_=eng.app.ups_cost_by_tracking(inv)
    o=pd.read_excel(STM, sheet_name="Overview")
    a=pd.read_excel(STM, sheet_name="Account Charges")
    matched=float(o["UPS"].sum())
    un=a[a["Type"]=="on invoice, not billed to client"]["Amount"].sum()
    accs=a[a["Type"]=="account charge (no tracking)"]["Amount"].sum()
    total=float(by["Net"].sum())+acct
    assert abs(matched+float(un)+float(accs)-total)<0.05, \
        (matched, un, accs, total)
    assert abs(float(accs)-acct)<0.01
    print(f"      對得上 {matched:,.2f} + 未對上 {float(un):,.2f} "
          f"+ 帳戶層 {float(accs):,.2f} = 發票 {total:,.2f}")
ck("成本與發票對帳（含未對上的票）", cost_reconciles_including_unmatched)

def big_credits_are_surfaced():
    """4 張 MSC 退款票沒有進客戶報表，必須被明確列出，不能默默消失。"""
    a=pd.read_excel(STM, sheet_name="Account Charges")
    un=a[a["Type"]=="on invoice, not billed to client"]
    assert len(un)>=4, len(un)
    assert float(un["Amount"].sum())<-9000, float(un["Amount"].sum())
    print(f"      未開給客戶的退款 {len(un)} 筆 ${float(un['Amount'].sum()):,.2f}")
ck("大額退款沒有被吞掉", big_credits_are_surfaced)

def csv_invoice_works():
    raw=pd.read_excel(INV, header=0, dtype=object)
    P=os.path.join(D,"inv_nohdr.csv"); raw.to_csv(P, index=False, header=False)
    e2=Engine({"dim_factor":"300","ahs_min_billable_weight":"15"})
    e2.load_rates([rat])
    by,_,_,_=e2.app.ups_cost_by_tracking(P)
    assert abs(float(by.loc["1Z174C7E0311451573","Net"])-26.88)<0.01
ck("無標題 CSV 發票也能跑", csv_invoice_works)

def missing_rates_says_so():
    e3=Engine({"dim_factor":"300"})
    try:
        e3.reprice(inv, os.path.join(D,"x.xlsx")); raise AssertionError("沒擋")
    except RuntimeError as e:
        assert "base rate" in str(e).lower(), str(e)[:80]
ck("沒有費率表會明確報錯", missing_rates_says_so)
print("\n"+("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}"))
raise SystemExit(1 if fails else 0)
