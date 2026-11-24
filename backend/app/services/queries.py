"""Read-only business queries shared by chatbots and agent tools (no raw SQL exposed to any LLM)."""
from datetime import date
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from app.models import (Inventory, Product, PurchaseOrder, PurchaseRequest, Supplier, SupplierProduct)
from app.services import inventory as inv

OPEN_PO = ("pending_approval", "approved", "sent", "partially_received")


def _po_rows(db, pos):
    names = {s.id: s.name for s in db.scalars(select(Supplier).where(Supplier.id.in_({p.supplier_id for p in pos})))} if pos else {}
    return [[p.po_number, names.get(p.supplier_id, ""), p.status, str(p.expected_delivery_date), str(p.total_amount)] for p in pos]


PO_COLS = ["PO", "Supplier", "Status", "Expected", "Total"]


def purchase_orders(db: Session, statuses=None, overdue=False, supplier_id=None, limit=15) -> tuple[int, list[PurchaseOrder]]:
    stmt = select(PurchaseOrder)
    if statuses: stmt = stmt.where(PurchaseOrder.status.in_(statuses))
    if overdue: stmt = stmt.where(PurchaseOrder.status.in_(("sent", "partially_received")), PurchaseOrder.expected_delivery_date < date.today())
    if supplier_id: stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    return total, list(db.scalars(stmt.order_by(PurchaseOrder.expected_delivery_date).limit(limit)))


def po_table(db, pos) -> dict:
    return {"columns": PO_COLS, "rows": _po_rows(db, pos)}


def low_stock(db: Session, limit=15, max_days_cover: float | None = None) -> tuple[int, list[dict]]:
    rows = [inv.to_out(i) for i in db.scalars(select(Inventory).where(
        (Inventory.quantity_on_hand - Inventory.quantity_reserved) <= Inventory.reorder_level)).unique()]
    if max_days_cover is not None:
        rows = [r for r in rows if r["days_of_cover"] is not None and r["days_of_cover"] <= max_days_cover]
    rows.sort(key=lambda r: (r["days_of_cover"] is None, r["days_of_cover"] or 0))
    return len(rows), rows[:limit]


def pending_requests(db: Session, limit=15):
    stmt = select(PurchaseRequest).where(PurchaseRequest.status.in_(("submitted", "pending_approval")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    return total, list(db.scalars(stmt.order_by(PurchaseRequest.created_at.desc()).limit(limit)))


def find_suppliers(db: Session, text: str, limit=5) -> list[Supplier]:
    return list(db.scalars(select(Supplier).where(or_(Supplier.name.ilike(f"%{text}%"), Supplier.code.ilike(f"%{text}%"))).limit(limit)))


def find_products(db: Session, text: str, limit=8) -> list[Product]:
    return list(db.scalars(select(Product).where(or_(Product.name.ilike(f"%{text}%"), Product.sku.ilike(f"%{text}%"))).limit(limit)))


def supplier_offers(db: Session, product_id) -> list[tuple[SupplierProduct, Supplier]]:
    rows = db.execute(select(SupplierProduct, Supplier).join(Supplier).where(SupplierProduct.product_id == product_id)).all()
    return sorted(rows, key=lambda r: r[0].unit_price)
