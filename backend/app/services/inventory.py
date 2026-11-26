"""Inventory calculations. Formulas are documented in docs/ARCHITECTURE.md.

available      = on_hand - reserved
projected      = available + on_order
days_of_cover  = available / avg_daily_demand   (None when demand is 0)
low_stock      = available <= reorder_level
reorder qty    = max(0, ceil(avg_daily_demand * (lead_time_days + review_days) + safety_stock - projected))
"""
import math
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import Inventory, SupplierProduct, Supplier, ChatbotConfiguration, ChatbotType

DEFAULT_REVIEW_DAYS = 7


def available(inv) -> int:
    return inv.quantity_on_hand - inv.quantity_reserved


def projected(inv) -> int:
    return available(inv) + inv.quantity_on_order


def days_of_cover(inv) -> float | None:
    d = float(inv.avg_daily_demand)
    return round(available(inv) / d, 1) if d > 0 else None


def is_low_stock(inv) -> bool:
    return available(inv) <= inv.reorder_level


def reorder_quantity(avg_daily_demand, lead_time_days: int, safety_stock: int, projected_qty: int,
                     review_days: int = DEFAULT_REVIEW_DAYS, min_order_qty: int = 1) -> int:
    need = math.ceil(float(avg_daily_demand) * (lead_time_days + review_days) + safety_stock - projected_qty)
    if need <= 0:
        return 0
    return max(need, min_order_qty)


def review_days(db: Session) -> int:
    v = db.scalar(select(ChatbotConfiguration.value).join(ChatbotType).where(ChatbotType.slug == "rule_based", ChatbotConfiguration.key == "review_days"))
    return int(v["value"]) if v else DEFAULT_REVIEW_DAYS


def best_supplier_for(db: Session, product_id):
    """Preferred supplier link (active supplier), else cheapest."""
    rows = db.execute(select(SupplierProduct, Supplier).join(Supplier).where(SupplierProduct.product_id == product_id, Supplier.is_active)).all()
    if not rows:
        return None
    rows.sort(key=lambda r: (not r[0].is_preferred, r[0].unit_price))
    return rows[0]


def to_out(inv) -> dict:
    return dict(id=inv.id, product_id=inv.product_id, sku=inv.product.sku, product_name=inv.product.name,
                warehouse_id=inv.warehouse_id, warehouse=inv.warehouse.name, quantity_on_hand=inv.quantity_on_hand,
                quantity_reserved=inv.quantity_reserved, quantity_on_order=inv.quantity_on_order,
                reorder_level=inv.reorder_level, safety_stock=inv.safety_stock, avg_daily_demand=inv.avg_daily_demand,
                available=available(inv), projected=projected(inv), days_of_cover=days_of_cover(inv),
                low_stock=is_low_stock(inv), updated_at=inv.updated_at)


def recommendations(db: Session, warehouse_id=None, limit: int = 100) -> list[dict]:
    rd = review_days(db)
    stmt = select(Inventory).where((Inventory.quantity_on_hand - Inventory.quantity_reserved) <= Inventory.reorder_level)
    if warehouse_id:
        stmt = stmt.where(Inventory.warehouse_id == warehouse_id)
    out = []
    for inv in db.scalars(stmt).unique():
        best = best_supplier_for(db, inv.product_id)
        lt = best[0].lead_time_days if best else 14
        moq = best[0].min_order_qty if best else 1
        qty = reorder_quantity(inv.avg_daily_demand, lt, inv.safety_stock, projected(inv), rd, moq)
        if qty <= 0:
            continue  # already covered by open orders
        out.append(dict(inventory_id=inv.id, avg_daily_demand=inv.avg_daily_demand, product_id=inv.product_id, sku=inv.product.sku, product_name=inv.product.name, warehouse=inv.warehouse.name, warehouse_id=inv.warehouse_id,
                        available=available(inv), projected=projected(inv), days_of_cover=days_of_cover(inv), suggested_quantity=qty,
                        supplier_id=best[1].id if best else None, supplier_name=best[1].name if best else None,
                        lead_time_days=lt if best else None, unit_price=best[0].unit_price if best else None))
    out.sort(key=lambda r: (r["days_of_cover"] is None, r["days_of_cover"] or 0))
    return out[:limit]
