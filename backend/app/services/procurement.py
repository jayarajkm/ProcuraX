"""Purchase order and purchase request state machines + calculations."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.errors import AppError, NotFound
from app.services import pricing
from app.models import (ApprovalHistory, ApprovalWorkflow, PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatusHistory,
                        PurchaseRequest, PurchaseRequestLine, SupplierProduct, User, Warehouse, Inventory, InventoryMovement)

TAX_RATE = Decimal("0.10")
PO_TRANSITIONS = {
    "draft": {"pending_approval", "cancelled"},
    "pending_approval": {"approved", "draft", "cancelled"},
    "approved": {"sent", "cancelled"},
    "sent": {"partially_received", "received", "cancelled"},
    "partially_received": {"received", "cancelled"},
    "received": set(), "cancelled": set(),
}
PO_TRANSITION_PERMISSION = {"approved": "po:approve"}  # sensitive transitions
REQ_TRANSITIONS = {
    "draft": {"submitted"}, "submitted": {"pending_approval"}, "pending_approval": {"approved", "rejected"},
    "approved": {"converted"}, "rejected": set(), "converted": set(),
}


def q2(x) -> Decimal:
    return Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calc_totals(lines: list[tuple[int, Decimal]], tax_rate: Decimal = TAX_RATE) -> tuple[Decimal, Decimal, Decimal]:
    subtotal = sum((q2(q * p) for q, p in lines), Decimal(0))
    tax = sum((q2(q2(q * p) * tax_rate) for q, p in lines), Decimal(0))
    return subtotal, tax, subtotal + tax


def next_number(db: Session, model, col, prefix: str, start: int, width: int = 0) -> str:
    n = db.scalar(select(func.count()).select_from(model)) + start + 1
    while db.scalar(select(func.count()).select_from(model).where(col == f"{prefix}{n:0{width}d}")):
        n += 1
    return f"{prefix}{n:0{width}d}"


def _permitted(user: User, perm: str) -> bool:
    return any(p.code == perm for r in user.roles for p in r.permissions)


def create_po(db: Session, user: User, supplier_id, warehouse_id, lines, expected: date | None, order_type: str | None = None) -> PurchaseOrder:
    wh = db.get(Warehouse, warehouse_id)
    if not wh:
        raise AppError("not_found", "Warehouse not found", 404)
    if wh.ownership_type == "customer":
        raise AppError("customer_owned_warehouse", f"{wh.name} holds stock owned by {wh.owner_name}; a purchase order cannot be raised against it", 409)
    if wh.ownership_type == "vendor":
        if supplier_id != wh.owner_supplier_id:
            raise AppError("vendor_owned_warehouse", f"{wh.name} is consignment stock owned by {wh.owner_name}; only that vendor can replenish it", 409)
        order_type = "consignment"
    order_type = order_type or "standard"
    price_rows = {sp.product_id: sp for sp in db.scalars(select(SupplierProduct).where(
        SupplierProduct.supplier_id == supplier_id, SupplierProduct.product_id.in_([l.product_id for l in lines])))}
    missing = [str(l.product_id) for l in lines if l.product_id not in price_rows]
    if missing:
        raise AppError("invalid_lines", "Some products are not offered by this supplier", 422, {"product_ids": missing})
    today = date.today()
    lead = max(price_rows[l.product_id].lead_time_days for l in lines)
    po = PurchaseOrder(organization_id=user.organization_id, po_number=next_number(db, PurchaseOrder, PurchaseOrder.po_number, "PO-", 2025000),
                       supplier_id=supplier_id, warehouse_id=warehouse_id, created_by=user.id, status="draft", order_type=order_type,
                       order_date=today, expected_delivery_date=expected or today + timedelta(days=lead))
    pairs = []
    for l in lines:
        sp = price_rows[l.product_id]
        price = pricing.supplier_unit_price(db, sp, l.quantity)  # quantity price break
        po.lines.append(PurchaseOrderLine(product_id=l.product_id, quantity=l.quantity, unit_price=price,
                                          tax_rate=TAX_RATE, line_total=q2(l.quantity * price)))
        pairs.append((l.quantity, price))
    po.subtotal, po.tax_amount, po.total_amount = calc_totals(pairs)
    po.history.append(PurchaseOrderStatusHistory(from_status=None, to_status="draft", changed_by=user.id))
    db.add(po); db.flush()
    return po


def change_po_status(db: Session, user: User, po: PurchaseOrder, to: str, note: str = "") -> PurchaseOrder:
    if to not in PO_TRANSITIONS.get(po.status, set()):
        raise AppError("invalid_transition", f"Cannot move purchase order from '{po.status}' to '{to}'", 409)
    perm = PO_TRANSITION_PERMISSION.get(to)
    if perm and not _permitted(user, perm):
        raise AppError("forbidden", f"Permission '{perm}' required for this transition", 403)
    po.history.append(PurchaseOrderStatusHistory(from_status=po.status, to_status=to, changed_by=user.id, note=note))
    prev = po.status
    po.status = to
    if to == "approved":  # an approved PO is committed supply: it counts as on order (same rule as the seed data)
        _stock(db, po, "on_order", +1)
    elif to == "received":
        po.actual_delivery_date = date.today()
        _receive(db, po)
    elif to == "cancelled" and prev in ("approved", "sent", "partially_received"):
        _stock(db, po, "release", +1)
    db.flush()
    return po


def _inv_row(db, product_id, warehouse_id) -> Inventory:
    inv = db.scalar(select(Inventory).where(Inventory.product_id == product_id, Inventory.warehouse_id == warehouse_id))
    if not inv:
        inv = Inventory(product_id=product_id, warehouse_id=warehouse_id, quantity_on_hand=0, quantity_reserved=0, quantity_on_order=0)
        db.add(inv); db.flush()
    return inv


def _stock(db, po: PurchaseOrder, what: str, sign: int) -> None:
    """Keep quantity_on_order in step with the PO: add when approved, release the unreceived part when cancelled."""
    for l in po.lines:
        inv = _inv_row(db, l.product_id, po.warehouse_id)
        if what == "on_order":
            inv.quantity_on_order += l.quantity
        else:
            inv.quantity_on_order = max(0, inv.quantity_on_order - (l.quantity - l.quantity_received))


def _receive(db, po: PurchaseOrder) -> None:
    """Goods receipt: on hand goes up by what has not been received yet, on order goes down, a ledger row is written."""
    for l in po.lines:
        qty = l.quantity - l.quantity_received
        l.quantity_received = l.quantity
        if qty <= 0:
            continue
        inv = _inv_row(db, l.product_id, po.warehouse_id)
        inv.quantity_on_hand += qty
        inv.quantity_on_order = max(0, inv.quantity_on_order - qty)
        db.add(InventoryMovement(inventory_id=inv.id, movement_type="receipt", quantity=qty, reference=po.po_number))


def create_request(db: Session, user: User, data) -> PurchaseRequest:
    r = PurchaseRequest(organization_id=user.organization_id, requested_by=user.id, justification=data.justification,
                        priority=data.priority, status="draft", requested_delivery_date=data.requested_delivery_date,
                        request_number=next_number(db, PurchaseRequest, PurchaseRequest.request_number, "REQ-", 0, 5))
    for l in data.lines:
        r.lines.append(PurchaseRequestLine(product_id=l.product_id, quantity=l.quantity, suggested_supplier_id=l.suggested_supplier_id))
    db.add(r); db.flush()
    return r


def _workflow(db: Session, r: PurchaseRequest) -> ApprovalWorkflow:
    wf = db.scalar(select(ApprovalWorkflow).where(ApprovalWorkflow.entity_type == "purchase_request", ApprovalWorkflow.entity_id == r.id))
    if not wf:
        wf = ApprovalWorkflow(entity_type="purchase_request", entity_id=r.id, required_permission="request:approve", status="pending")
        db.add(wf); db.flush()
    return wf


def request_transition(db: Session, user: User, r: PurchaseRequest, to: str, comment: str = "") -> PurchaseRequest:
    if to not in REQ_TRANSITIONS.get(r.status, set()):
        raise AppError("invalid_transition", f"Cannot move request from '{r.status}' to '{to}'", 409)
    if to in ("approved", "rejected") and not _permitted(user, "request:approve"):
        raise AppError("forbidden", "Permission 'request:approve' required", 403)
    wf = _workflow(db, r)
    if to in ("approved", "rejected"):
        wf.status = to
    db.add(ApprovalHistory(workflow_id=wf.id, action=to, actor_id=user.id, comment=comment))
    r.status = to
    db.flush()
    return r


def submit_request(db: Session, user: User, r: PurchaseRequest, comment: str = "") -> PurchaseRequest:
    """draft -> submitted -> pending_approval (two recorded steps)."""
    request_transition(db, user, r, "submitted", comment)
    return request_transition(db, user, r, "pending_approval", "Awaiting approval")


def convert_request(db: Session, user: User, r: PurchaseRequest) -> PurchaseOrder:
    if r.status != "approved":
        raise AppError("invalid_transition", "Only approved requests can be converted", 409)
    if not _permitted(user, "po:write"):
        raise AppError("forbidden", "Permission 'po:write' required", 403)
    from app.api.schemas_shim import LineShim
    by_supplier: dict = {}
    for l in r.lines:
        if not l.suggested_supplier_id:
            raise AppError("missing_supplier", "Every request line needs a suggested supplier before conversion", 422)
        by_supplier.setdefault(l.suggested_supplier_id, []).append(l)
    wh = db.scalar(select(Warehouse).where(Warehouse.ownership_type == "self").order_by(Warehouse.code).limit(1))  # customer/vendor-owned stock cannot be bought for
    if not wh:
        raise AppError("no_warehouse", "No company-owned warehouse exists to receive this order", 409)
    pos = []
    for sid, ls in by_supplier.items():
        po = create_po(db, user, sid, wh.id, [LineShim(l.product_id, l.quantity) for l in ls], r.requested_delivery_date)
        po.source_request_id = r.id
        pos.append(po)
    request_transition(db, user, r, "converted", f"Converted to {', '.join(p.po_number for p in pos)}")
    return pos[0]
