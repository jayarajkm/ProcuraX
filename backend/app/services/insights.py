"""Business insights computed from the database (deterministic), with an optional LLM narrative."""
from datetime import datetime, timedelta, timezone
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.models import ApprovalWorkflow, PurchaseRequest
from app.services import dashboard, queries as q


def computed(db: Session) -> list[dict]:
    d = dashboard.overview(db)
    out = []

    def add(sev, title, detail, source, link=None):
        out.append({"severity": sev, "title": title, "detail": detail, "source": source, "link": link})

    t7, rows7 = q.low_stock(db, limit=5, max_days_cover=7)
    if t7:
        worst = rows7[0]
        add("high", f"{t7} stock record(s) have 7 days of cover or less",
            f"Lowest: {worst['sku']} {worst['product_name']} at {worst['warehouse']} ({worst['days_of_cover']} days).", "inventory", "/inventory")
    if d["overdue_purchase_orders"]:
        add("high", f"{d['overdue_purchase_orders']} purchase order(s) are overdue", "Sent or partially received orders past their expected delivery date.", "purchase_orders", "/purchase-orders")
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    stale = db.scalar(select(func.count()).select_from(PurchaseRequest).where(PurchaseRequest.status == "pending_approval", PurchaseRequest.updated_at < cutoff))
    if stale:
        add("medium", f"{stale} purchase request(s) have waited over 7 days for approval", "Pending approval with no update in the last 7 days.", "purchase_requests", "/requests")
    ranked = [p for p in d["supplier_performance"] if p["on_time_rate"] is not None and p["received"] >= 3]
    if ranked:
        w = min(ranked, key=lambda p: p["on_time_rate"])
        add("medium" if w["on_time_rate"] < 0.7 else "low", f"Lowest on-time delivery among busy suppliers: {w['name']} ({w['on_time_rate']:.0%})",
            f"{w['on_time']} of {w['received']} received orders arrived on time.", "suppliers", "/suppliers")
    pend = d["po_status_breakdown"].get("pending_approval", 0)
    if pend:
        add("low", f"{pend} purchase order(s) are awaiting approval", "Managers can approve them from the Purchase Orders page.", "purchase_orders", "/purchase-orders")
    try:
        from app.ml import predict as P
        r = P.stockout_scan(db, limit=3)
        if r["flagged"]:
            top = r["items"][0]
            add("medium", f"ML model flags {r['flagged']} stock record(s) at risk of stockout within lead time",
                f"Highest risk: {top['sku']} {top['product_name']} at {top['warehouse']} (p={top['risk_probability']}). Model output, not a guarantee.", "ml:stockout_risk", "/ml")
    except Exception:
        pass
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda i: order[i["severity"]])


def narrative(db: Session, items: list[dict]) -> dict:
    from app.chatbot.generative.provider import ProviderError, ProviderNotConfigured, get_provider
    try:
        prov = get_provider()
    except ProviderNotConfigured as e:
        return {"text": None, "reason": str(e)}
    facts = "\n".join(f"- [{i['severity']}] {i['title']}. {i['detail']}" for i in items) or "- No notable issues."
    try:
        r = prov.complete("You are a procurement analyst. Summarise the facts in 3 short sentences with the most important action first. Use only the facts given.",
                          [{"role": "user", "content": facts}], max_tokens=300)
        return {"text": r.text, "model": r.model, "reason": None}
    except ProviderError as e:
        return {"text": None, "reason": str(e)}
