"""Dashboard aggregates: every figure is computed from PostgreSQL."""
from datetime import date
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from app.models import (Inventory, Product, PurchaseOrder, PurchaseRequest, Supplier, PurchaseOrderStatusHistory)

OPEN_PO = ("pending_approval", "approved", "sent", "partially_received")


def overview(db: Session) -> dict:
    inv_value = db.scalar(text("select coalesce(sum((i.quantity_on_hand) * p.unit_price),0) from inventory i join products p on p.id=i.product_id"))
    low = db.scalar(text("select count(*) from inventory where quantity_on_hand - quantity_reserved <= reorder_level"))
    low_products = db.scalar(text("select count(distinct product_id) from inventory where quantity_on_hand - quantity_reserved <= reorder_level"))
    overdue = db.scalar(select(func.count()).select_from(PurchaseOrder).where(
        PurchaseOrder.status.in_(("sent", "partially_received")), PurchaseOrder.expected_delivery_date < date.today()))
    perf = db.execute(text("""
        select s.id, s.code, s.name, s.rating, count(o.id) filter (where o.status='received') as received,
               count(o.id) filter (where o.status='received' and o.actual_delivery_date <= o.expected_delivery_date) as on_time,
               count(o.id) as orders
        from suppliers s left join purchase_orders o on o.supplier_id=s.id
        group by s.id order by orders desc limit 8""")).mappings().all()
    recent = db.execute(text("""
        select o.po_number, h.to_status, h.changed_at from purchase_order_status_history h
        join purchase_orders o on o.id=h.purchase_order_id order by h.changed_at desc limit 10""")).mappings().all()
    by_status = db.execute(select(PurchaseOrder.status, func.count()).group_by(PurchaseOrder.status)).all()
    return {
        "is_demo_data": True,
        "total_products": db.scalar(select(func.count()).select_from(Product)),
        "total_suppliers": db.scalar(select(func.count()).select_from(Supplier)),
        "inventory_value": float(inv_value),
        "low_stock_records": low, "low_stock_products": low_products,
        "open_purchase_orders": db.scalar(select(func.count()).select_from(PurchaseOrder).where(PurchaseOrder.status.in_(OPEN_PO))),
        "overdue_purchase_orders": overdue,
        "pending_purchase_requests": db.scalar(select(func.count()).select_from(PurchaseRequest).where(PurchaseRequest.status.in_(("submitted", "pending_approval")))),
        "supplier_performance": [dict(r, rating=float(r["rating"]), on_time_rate=(round(r["on_time"] / r["received"], 3) if r["received"] else None)) for r in perf],
        "po_status_breakdown": {s: c for s, c in by_status},
        "recent_activity": [dict(po_number=r["po_number"], status=r["to_status"], at=r["changed_at"].isoformat()) for r in recent],
    }
