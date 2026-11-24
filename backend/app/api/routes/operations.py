import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.deps import audit, require
from app.core.errors import AppError, NotFound
from app.database.session import get_db
from app.models import (ApprovalHistory, ApprovalWorkflow, Inventory, InventoryMovement, PurchaseOrder, PurchaseRequest, User)
from app.repositories.base import paginate
from app.schemas.business import *
from app.schemas.common import Page
from app.services import dashboard as dash
from app.services import inventory as inv_svc
from app.services import procurement as proc

router = APIRouter(tags=["operations"])


@router.get("/dashboard/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    return dash.overview(db)


@router.get("/inventory", response_model=Page[InventoryOut])
def list_inventory(warehouse_id: uuid.UUID | None = None, low_stock: bool | None = None, q: str | None = None, page: int = Query(1, ge=1),
                   page_size: int = Query(25, ge=1, le=200), sort: str | None = None, order: str = Query("asc", pattern="^(asc|desc)$"), db: Session = Depends(get_db), _: User = Depends(require("inventory:read"))):
    from app.models import Product
    stmt = select(Inventory).join(Product, Product.id == Inventory.product_id)
    if warehouse_id: stmt = stmt.where(Inventory.warehouse_id == warehouse_id)
    low = (Inventory.quantity_on_hand - Inventory.quantity_reserved) <= Inventory.reorder_level
    if low_stock is True: stmt = stmt.where(low)
    if low_stock is False: stmt = stmt.where(~low)
    if q: stmt = stmt.where(Product.name.ilike(f"%{q}%") | Product.sku.ilike(f"%{q}%"))
    smap = {"product": Product.name, "sku": Product.sku, "on_hand": Inventory.quantity_on_hand, "reorder_level": Inventory.reorder_level,
            "avg_daily_demand": Inventory.avg_daily_demand, "available": Inventory.quantity_on_hand - Inventory.quantity_reserved}
    res = paginate(db, stmt, page, page_size, smap, sort, order, Product.name)
    res["items"] = [inv_svc.to_out(i) for i in res["items"]]
    return res


@router.get("/inventory/reorder-recommendations", response_model=list[ReorderRecommendation])
def reorder(warehouse_id: uuid.UUID | None = None, db: Session = Depends(get_db), _: User = Depends(require("inventory:read"))):
    return inv_svc.recommendations(db, warehouse_id)


@router.get("/inventory/{iid}/movements", response_model=list[MovementOut])
def movements(iid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("inventory:read"))):
    return db.scalars(select(InventoryMovement).where(InventoryMovement.inventory_id == iid).order_by(InventoryMovement.occurred_at.desc())).all()


@router.post("/inventory/{iid}/adjust", response_model=InventoryOut)
def adjust(iid: uuid.UUID, body: InventoryAdjust, db: Session = Depends(get_db), user: User = Depends(require("inventory:write"))):
    inv = db.get(Inventory, iid)
    if not inv: raise NotFound("Inventory record")
    new = inv.quantity_on_hand + body.quantity
    if new < inv.quantity_reserved:
        raise AppError("invalid_adjustment", "Adjustment would drop on-hand below reserved quantity", 409)
    inv.quantity_on_hand = new
    db.add(InventoryMovement(inventory_id=iid, movement_type="adjustment", quantity=body.quantity, reference=body.reason))
    audit(db, user, "inventory.adjust", "inventory", iid, delta=body.quantity); db.commit(); db.refresh(inv)
    return inv_svc.to_out(inv)


@router.get("/purchase-orders", response_model=Page[POOut])
def list_pos(status: str | None = None, supplier_id: uuid.UUID | None = None, q: str | None = None, page: int = Query(1, ge=1),
             page_size: int = Query(25, ge=1, le=200), sort: str | None = "order_date", order: str = Query("desc", pattern="^(asc|desc)$"),
             db: Session = Depends(get_db), _: User = Depends(require("po:read"))):
    stmt = select(PurchaseOrder)
    if status: stmt = stmt.where(PurchaseOrder.status == status)
    if supplier_id: stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
    if q: stmt = stmt.where(PurchaseOrder.po_number.ilike(f"%{q}%"))
    smap = {"order_date": PurchaseOrder.order_date, "total": PurchaseOrder.total_amount, "po_number": PurchaseOrder.po_number,
            "expected": PurchaseOrder.expected_delivery_date}
    return paginate(db, stmt, page, page_size, smap, sort, order, PurchaseOrder.order_date)


@router.get("/purchase-orders/{po_id}", response_model=PODetail)
def get_po(po_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("po:read"))):
    po = db.get(PurchaseOrder, po_id)
    if not po: raise NotFound("Purchase order")
    return po


@router.post("/purchase-orders", response_model=PODetail, status_code=201)
def create_po(body: POCreate, db: Session = Depends(get_db), user: User = Depends(require("po:write"))):
    po = proc.create_po(db, user, body.supplier_id, body.warehouse_id, body.lines, body.expected_delivery_date)
    audit(db, user, "po.create", "purchase_order", po.id); db.commit()
    return po


@router.post("/purchase-orders/{po_id}/status", response_model=PODetail)
def po_status(po_id: uuid.UUID, body: POStatusChange, db: Session = Depends(get_db), user: User = Depends(require("po:write"))):
    po = db.get(PurchaseOrder, po_id)
    if not po: raise NotFound("Purchase order")
    proc.change_po_status(db, user, po, body.to_status, body.note)
    audit(db, user, "po.status", "purchase_order", po_id, to=body.to_status); db.commit()
    return po


@router.get("/purchase-requests", response_model=Page[RequestOut])
def list_requests(status: str | None = None, q: str | None = None, priority: str | None = None, sort: str | None = None,
                  order: str = Query("desc", pattern="^(asc|desc)$"), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
                  db: Session = Depends(get_db), _: User = Depends(require("request:read"))):
    stmt = select(PurchaseRequest)
    if status: stmt = stmt.where(PurchaseRequest.status == status)
    if priority: stmt = stmt.where(PurchaseRequest.priority == priority)
    if q: stmt = stmt.where(PurchaseRequest.request_number.ilike(f"%{q}%") | PurchaseRequest.justification.ilike(f"%{q}%"))
    smap = {"created_at": PurchaseRequest.created_at, "request_number": PurchaseRequest.request_number, "priority": PurchaseRequest.priority}
    return paginate(db, stmt, page, page_size, smap, sort, order, PurchaseRequest.created_at)


def _req(db, rid):
    r = db.get(PurchaseRequest, rid)
    if not r: raise NotFound("Purchase request")
    return r


@router.get("/purchase-requests/{rid}", response_model=RequestOut)
def get_request(rid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("request:read"))):
    return _req(db, rid)


@router.get("/purchase-requests/{rid}/approvals", response_model=list[ApprovalHistoryOut])
def request_approvals(rid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("request:read"))):
    wf = db.scalar(select(ApprovalWorkflow).where(ApprovalWorkflow.entity_type == "purchase_request", ApprovalWorkflow.entity_id == rid))
    if not wf: return []
    return db.scalars(select(ApprovalHistory).where(ApprovalHistory.workflow_id == wf.id).order_by(ApprovalHistory.acted_at)).all()


@router.post("/purchase-requests", response_model=RequestOut, status_code=201)
def create_request(body: RequestCreate, db: Session = Depends(get_db), user: User = Depends(require("request:write"))):
    r = proc.create_request(db, user, body); audit(db, user, "request.create", "purchase_request", r.id); db.commit()
    return r


@router.post("/purchase-requests/{rid}/submit", response_model=RequestOut)
def submit(rid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require("request:write"))):
    r = proc.submit_request(db, user, _req(db, rid)); audit(db, user, "request.submit", "purchase_request", rid); db.commit()
    return r


@router.post("/purchase-requests/{rid}/approve", response_model=RequestOut)
def approve(rid: uuid.UUID, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(require("request:approve"))):
    r = proc.request_transition(db, user, _req(db, rid), "approved", body.comment); audit(db, user, "request.approve", "purchase_request", rid); db.commit()
    return r


@router.post("/purchase-requests/{rid}/reject", response_model=RequestOut)
def reject(rid: uuid.UUID, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(require("request:approve"))):
    r = proc.request_transition(db, user, _req(db, rid), "rejected", body.comment); audit(db, user, "request.reject", "purchase_request", rid); db.commit()
    return r


@router.post("/purchase-requests/{rid}/convert", response_model=PODetail)
def convert(rid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require("po:write"))):
    po = proc.convert_request(db, user, _req(db, rid)); audit(db, user, "request.convert", "purchase_request", rid, po=po.po_number); db.commit()
    return po
