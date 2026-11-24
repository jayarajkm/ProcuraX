"""Intent -> backend service routing. Each action only reads data."""
from sqlalchemy.orm import Session
from app.chatbot.types import ChatResult
from app.services import queries as q


def _po_result(db, intent_desc, total, pos, extra_steps=None) -> ChatResult:
    if not total:
        return ChatResult(reply=f"No purchase orders found for: {intent_desc}.", approach="Intent -> service query", data_sources=["purchase_orders"])
    return ChatResult(reply=f"Found {total} purchase order(s) — {intent_desc}. Showing {len(pos)} (soonest expected delivery first).",
                      approach="Intent -> service query", data_sources=["purchase_orders", "suppliers"], table=q.po_table(db, pos))


def _po_lookup(db, ents):
    from sqlalchemy import select
    from app.models import PurchaseOrder
    if "po_number" not in ents:
        return ChatResult(reply="Which purchase order? Give a PO number like PO-2025074.", approach="Intent recognised; required entity missing", data_sources=["purchase_orders"])
    po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.po_number == ents["po_number"]))
    if not po:
        return ChatResult(reply=f"I couldn't find purchase order {ents['po_number']}.", approach="Entity -> service query (no match)", data_sources=["purchase_orders"])
    late = po.status in ("sent", "partially_received") and po.expected_delivery_date < __import__("datetime").date.today()
    rec = f", delivered {po.actual_delivery_date}" if po.actual_delivery_date else ""
    return ChatResult(reply=f"{po.po_number}: {po.status.replace('_', ' ')}{' (OVERDUE)' if late else ''} — supplier {po.supplier.name}, warehouse {po.warehouse.name}, ordered {po.order_date}, expected {po.expected_delivery_date}{rec}, total {po.total_amount} (incl. tax {po.tax_amount}).",
                      approach="Entity -> service query", data_sources=["purchase_orders", "purchase_order_lines", "suppliers"],
                      table={"columns": ["SKU", "Product", "Qty", "Received", "Unit price"], "rows": [[l.product_sku, l.product_name, l.quantity, l.quantity_received, str(l.unit_price)] for l in po.lines]})


def _request_lookup(db, ents):
    from sqlalchemy import select
    from app.models import PurchaseRequest
    if "request_number" not in ents:
        return ChatResult(reply="Which request? Give a request number like REQ-00012.", approach="Intent recognised; required entity missing", data_sources=["purchase_requests"])
    r = db.scalar(select(PurchaseRequest).where(PurchaseRequest.request_number == ents["request_number"]))
    if not r:
        return ChatResult(reply=f"I couldn't find purchase request {ents['request_number']}.", approach="Entity -> service query (no match)", data_sources=["purchase_requests"])
    return ChatResult(reply=f"{r.request_number}: {r.status.replace('_', ' ')}, priority {r.priority}. Justification: {r.justification}",
                      approach="Entity -> service query", data_sources=["purchase_requests", "purchase_request_lines"],
                      table={"columns": ["SKU", "Product", "Qty", "Suggested supplier"], "rows": [[l.product_sku, l.product_name, l.quantity, l.suggested_supplier_name or "—"] for l in r.lines]})


def run(db: Session, action: str, ents: dict) -> ChatResult:
    if action == "show_purchase_order": return _po_lookup(db, ents)
    if action == "show_request": return _request_lookup(db, ents)
    if action == "show_po_summary":
        from sqlalchemy import func, select
        from app.models import PurchaseOrder
        rows = db.execute(select(PurchaseOrder.status, func.count()).group_by(PurchaseOrder.status).order_by(func.count().desc())).all()
        return ChatResult(reply=f"There are {sum(c for _, c in rows)} purchase orders in total.", approach="Intent -> service query", data_sources=["purchase_orders"],
                          table={"columns": ["Status", "Count"], "rows": [[s.replace('_', ' '), c] for s, c in rows]})
    if action == "show_reorder":
        from app.services import inventory as inv_svc
        recs = inv_svc.recommendations(db, limit=15)
        return ChatResult(reply=f"{len(recs)} item(s) need reordering (showing most urgent first). Quantity = ceil(daily demand x (lead time + review days) + safety stock - projected stock).",
                          approach="Intent -> inventory reorder formula (deterministic)", data_sources=["inventory", "supplier_products"],
                          table={"columns": ["SKU", "Product", "Warehouse", "Days cover", "Suggested qty", "Supplier", "Lead (d)"],
                                 "rows": [[r["sku"], r["product_name"], r["warehouse"], r["days_of_cover"], r["suggested_quantity"], r["supplier_name"], r["lead_time_days"]] for r in recs]})
    if action == "list_suppliers":
        from sqlalchemy import select
        from app.models import Supplier
        stmt = select(Supplier).where(Supplier.is_active).order_by(Supplier.rating.desc())
        if "country" in ents: stmt = stmt.where(Supplier.country == ents["country"])
        sups = list(db.scalars(stmt.limit(15)))
        return ChatResult(reply=f"{len(sups)} supplier(s){' in ' + ents['country'] if 'country' in ents else ''}, best rated first.", approach="Intent -> service query", data_sources=["suppliers"],
                          table={"columns": ["Code", "Name", "Country", "Rating", "Lead (d)", "Terms"], "rows": [[s.code, s.name, s.country, str(s.rating), s.avg_lead_time_days, s.payment_terms] for s in sups]})
    if action == "show_supplier_orders":
        if "supplier" not in ents:
            return ChatResult(reply="Which supplier? Mention a supplier name or code (e.g. SUP-005).", approach="Intent recognised; required entity missing", data_sources=["suppliers"])
        kw = {"supplier_id": ents["supplier"]["id"], "limit": 15}
        if "status" in ents: kw["statuses"] = [ents["status"]]
        t, pos = q.purchase_orders(db, **kw)
        return _po_result(db, f"supplier {ents['supplier']['name']}" + (f", status {ents['status']}" if "status" in ents else ""), t, pos)
    if action == "reply_greeting":
        return ChatResult(reply="Hello! Ask me about purchase orders, low stock, reorder suggestions, pending requests, suppliers or products. Say 'help' for examples.", approach="Intent -> canned reply")
    if action == "reply_help":
        return ChatResult(reply="Try: 'show open purchase orders', 'which orders are overdue', 'details of PO-2025074', 'status of REQ-00012', 'what is low on stock', 'what should I reorder', 'list suppliers in Germany', 'orders from supplier SUP-005', 'find product FAS-0001', 'how many purchase orders do we have'.", approach="Intent -> canned reply")
    if action == "reply_thanks":
        return ChatResult(reply="You're welcome!", approach="Intent -> canned reply")
    if action == "show_open_purchase_orders":
        kw = {"statuses": [ents["status"]]} if "status" in ents else {"statuses": q.OPEN_PO}
        if "supplier" in ents: kw["supplier_id"] = ents["supplier"]["id"]
        t, pos = q.purchase_orders(db, **kw)
        return _po_result(db, (f"status {ents['status'].replace('_', ' ')}" if "status" in ents else "open orders") + (f", supplier {ents['supplier']['name']}" if "supplier" in ents else ""), t, pos)
    if action == "show_pending_approval_pos":
        t, pos = q.purchase_orders(db, statuses=["pending_approval"])
        return _po_result(db, "awaiting approval", t, pos)
    if action == "show_overdue_pos":
        t, pos = q.purchase_orders(db, overdue=True)
        return _po_result(db, "past expected delivery date and not yet received", t, pos)
    if action == "show_low_stock":
        t, rows = q.low_stock(db)
        return ChatResult(reply=f"{t} stock record(s) are at or below reorder level. Showing the {len(rows)} with the least days of cover.",
                          approach="Intent -> service query", data_sources=["inventory", "products", "warehouses"],
                          table={"columns": ["SKU", "Product", "Warehouse", "Available", "Reorder level", "Days cover"],
                                 "rows": [[r["sku"], r["product_name"], r["warehouse"], r["available"], r["reorder_level"], r["days_of_cover"]] for r in rows]})
    if action == "show_pending_requests":
        t, rs = q.pending_requests(db)
        return ChatResult(reply=f"{t} purchase request(s) are awaiting a decision.", approach="Intent -> service query", data_sources=["purchase_requests"],
                          table={"columns": ["Request", "Priority", "Status", "Lines"], "rows": [[r.request_number, r.priority, r.status, len(r.lines)] for r in rs]})
    if action == "show_supplier":
        if "supplier" not in ents:
            return ChatResult(reply="Which supplier? Mention a supplier name or code (e.g. SUP-003).", approach="Intent recognised; required entity missing", data_sources=["suppliers"])
        s = q.find_suppliers(db, ents["supplier"]["name"])[0]
        return ChatResult(reply=f"{s.name} ({s.code}) — {s.country}, rating {s.rating}, avg lead time {s.avg_lead_time_days} days, terms {s.payment_terms}, contact {s.contact_person}.",
                          approach="Intent + entity -> service query", data_sources=["suppliers"])
    if action == "show_product":
        key = ents.get("sku")
        found = q.find_products(db, key) if key else []
        if not found:
            return ChatResult(reply="Give me a SKU (e.g. FAS-0001) to look up a product.", approach="Intent recognised; required entity missing", data_sources=["products"])
        p = found[0]
        return ChatResult(reply=f"{p.sku}: {p.name} — {p.category.name}, {p.unit_price} per {p.unit_of_measure}, manufacturer {p.manufacturer}, {'active' if p.is_active else 'inactive'}.",
                          approach="Intent + entity -> service query", data_sources=["products"])
    return ChatResult(reply="Intent recognised but no action is wired to it.", approach="Intent routing")
