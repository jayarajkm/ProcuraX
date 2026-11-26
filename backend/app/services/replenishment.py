"""Warehouse shortage -> purchase orders, aware of who owns the stock and of supplier price breaks.

Ownership rules (the stock owner decides who can be asked to replenish):
  self     we buy from the best supplier (standard PO)
  vendor   consignment stock: only the owning vendor can replenish; PO is order_type 'consignment' (cost is incurred
           when the stock is consumed, not on receipt)
  customer stock is the customer's property: we cannot buy it; the shortage is flagged for the customer, no PO
Quantity: the needed quantity comes from the reorder formula (inventory.recommendations). If a higher supplier price
break is close (<= BREAK_COVER_DAYS of extra demand) it is offered as `break_option`; it is only applied automatically
when buying up to the break does not cost more in total, or when the caller asks for it (take_price_breaks).
"""
from collections import defaultdict
from decimal import Decimal
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.errors import AppError
from app.models import PurchaseOrder, PurchaseOrderLine, SupplierProduct, Warehouse
from app.services import inventory as inv_svc
from app.services import pricing

BREAK_COVER_DAYS = 60


def _supplier_link(db, product_id, supplier_id):
    return db.scalar(select(SupplierProduct).where(SupplierProduct.product_id == product_id, SupplierProduct.supplier_id == supplier_id))


def pending_draft_qty(db: Session) -> dict:
    """Quantity already on purchase orders that exist but have not been sent (draft / pending approval / approved).
    Counted so a second click on 'create POs' does not duplicate them."""
    rows = db.execute(select(PurchaseOrder.warehouse_id, PurchaseOrderLine.product_id, func.sum(PurchaseOrderLine.quantity))
                      .join(PurchaseOrderLine, PurchaseOrderLine.purchase_order_id == PurchaseOrder.id)
                      .where(PurchaseOrder.status.in_(("draft", "pending_approval", "approved")))
                      .group_by(PurchaseOrder.warehouse_id, PurchaseOrderLine.product_id)).all()
    return {(w, p): int(q) for w, p, q in rows}


def shortages(db: Session, warehouse_id=None, take_price_breaks: bool = False) -> list[dict]:
    rows = []
    whs = {w.id: w for w in db.scalars(select(Warehouse))}
    pending = pending_draft_qty(db)
    for r in inv_svc.recommendations(db, warehouse_id, limit=500):
        wh = whs[r["warehouse_id"]]
        covered = pending.get((r["warehouse_id"], r["product_id"]), 0)
        if covered:
            r = dict(r, suggested_quantity=r["suggested_quantity"] - covered)
            if r["suggested_quantity"] <= 0:
                continue  # an unsent PO already covers this shortage
        row = dict(r, ownership_type=wh.ownership_type, owner_name=wh.owner_name, needed_quantity=r["suggested_quantity"],
                   quantity=r["suggested_quantity"], action="purchase", reason="", unit_price=None, line_total=None,
                   break_option=None, break_applied=False, order_type="standard")
        if wh.ownership_type == "customer":
            row.update(action="notify_customer", reason=f"Stock is owned by {wh.owner_name}; ask them to replenish. No PO can be raised.",
                       supplier_id=None, supplier_name=None, lead_time_days=None)
            rows.append(row); continue
        if wh.ownership_type == "vendor":
            link = _supplier_link(db, r["product_id"], wh.owner_supplier_id)
            if not link:
                row.update(action="no_supplier", reason=f"{wh.owner_name} owns this warehouse but does not list this product.",
                           supplier_id=None, supplier_name=None, lead_time_days=None)
                rows.append(row); continue
            row.update(action="consignment", order_type="consignment", supplier_id=wh.owner_supplier_id, supplier_name=wh.owner_name,
                       lead_time_days=link.lead_time_days, reason="Vendor-owned (consignment): cost is incurred when the stock is used.")
            qty = max(row["needed_quantity"], link.min_order_qty)
            link_ = link
        else:
            if not r["supplier_id"]:
                row.update(action="no_supplier", reason="No active supplier offers this product.")
                rows.append(row); continue
            link_ = _supplier_link(db, r["product_id"], r["supplier_id"])
            qty = row["needed_quantity"]
        breaks = pricing.supplier_breaks(db, link_.id)
        price = pricing.tier_price(breaks, qty, link_.unit_price)
        nb = pricing.next_break(breaks, qty)
        if nb:
            demand = float(r["avg_daily_demand"])
            extra = nb[0] - qty
            cost_now, cost_break = pricing.q2(price * qty), pricing.q2(nb[1] * nb[0])
            extra_cost = cost_break - cost_now
            if demand <= 0 or extra <= demand * BREAK_COVER_DAYS:
                opt = dict(min_qty=nb[0], unit_price=nb[1], extra_units=extra, extra_cost=extra_cost,
                           saving_per_unit=pricing.q2(price - nb[1]), cheaper_in_total=cost_break <= cost_now)
                row["break_option"] = opt
                if cost_break <= cost_now or take_price_breaks:
                    qty, price = nb[0], nb[1]; row["break_applied"] = True
        row.update(quantity=qty, unit_price=price, line_total=pricing.q2(price * qty))
        rows.append(row)
    return rows


def create_pos(db: Session, user, warehouse_id, product_ids: list | None = None, take_price_breaks: bool = False):
    from app.services import procurement as proc
    from app.api.schemas_shim import LineShim
    wh = db.get(Warehouse, warehouse_id)
    if not wh:
        raise AppError("not_found", "Warehouse not found", 404)
    rows = shortages(db, warehouse_id, take_price_breaks)
    if product_ids:
        wanted = set(product_ids)
        rows = [r for r in rows if r["product_id"] in wanted]
    groups, skipped = defaultdict(list), []
    for r in rows:
        if r["action"] in ("purchase", "consignment"):
            groups[(r["supplier_id"], r["order_type"])].append(r)
        else:
            skipped.append(dict(sku=r["sku"], action=r["action"], reason=r["reason"]))
    pos = []
    for (supplier_id, order_type), lines in groups.items():
        po = proc.create_po(db, user, supplier_id, warehouse_id, [LineShim(l["product_id"], l["quantity"]) for l in lines], None, order_type=order_type)
        pos.append(po)
    return pos, skipped
