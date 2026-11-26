import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.api.deps import audit, require
from app.core.errors import AppError, NotFound
from app.database.session import get_db
from app.models import Customer, Product, SalesPriceBreak, SupplierPriceBreak, SupplierProduct, User, Warehouse, Supplier
from app.schemas.business import *
from app.services import pricing, replenishment

router = APIRouter(tags=["distribution"])


def _dedupe(body: BreaksIn):
    qtys = [b.min_qty for b in body.breaks]
    if len(qtys) != len(set(qtys)):
        raise AppError("invalid_breaks", "Two price breaks have the same minimum quantity", 422)
    ordered = sorted(body.breaks, key=lambda b: b.min_qty)
    if any(ordered[i + 1].unit_price > ordered[i].unit_price for i in range(len(ordered) - 1)):
        raise AppError("invalid_breaks", "A higher quantity tier must not cost more per unit than a lower one", 422)
    return ordered


# ---- customers
@router.get("/customers", response_model=list[CustomerOut])
def customers(db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    return db.scalars(select(Customer).where(Customer.is_active).order_by(Customer.name)).all()


@router.post("/customers", response_model=CustomerOut, status_code=201)
def create_customer(body: CustomerCreate, db: Session = Depends(get_db), user: User = Depends(require("product:write"))):
    c = Customer(organization_id=user.organization_id, **body.model_dump())
    db.add(c)
    try:
        db.flush(); audit(db, user, "customer.create", "customer", c.id); db.commit()
    except IntegrityError:
        db.rollback(); raise AppError("conflict", "Customer code already exists", 409)
    return c


# ---- warehouses (ownership)
@router.get("/warehouses/ownership-summary")
def ownership_summary(db: Session = Depends(get_db), _: User = Depends(require("inventory:read"))):
    from app.models import Inventory
    from sqlalchemy import func
    rows = db.execute(select(Warehouse.id, func.count(Inventory.id), func.coalesce(func.sum(Inventory.quantity_on_hand), 0))
                      .join(Inventory, Inventory.warehouse_id == Warehouse.id, isouter=True).group_by(Warehouse.id)).all()
    return {str(i): dict(skus=n, units_on_hand=int(u)) for i, n, u in rows}


# ---- supplier price breaks (buy side)
def _sp(db, supplier_id, product_id) -> SupplierProduct:
    sp = db.scalar(select(SupplierProduct).where(SupplierProduct.supplier_id == supplier_id, SupplierProduct.product_id == product_id))
    if not sp:
        raise NotFound("Supplier product")
    return sp


@router.get("/price-breaks/supplier/{supplier_id}/{product_id}")
def get_supplier_breaks(supplier_id: uuid.UUID, product_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("supplier:read"))):
    sp = _sp(db, supplier_id, product_id)
    return dict(base_price=sp.unit_price, min_order_qty=sp.min_order_qty,
                breaks=[dict(min_qty=m, unit_price=p) for m, p in sorted(pricing.supplier_breaks(db, sp.id))])


@router.put("/price-breaks/supplier/{supplier_id}/{product_id}")
def put_supplier_breaks(supplier_id: uuid.UUID, product_id: uuid.UUID, body: BreaksIn, db: Session = Depends(get_db), user: User = Depends(require("supplier:write"))):
    sp = _sp(db, supplier_id, product_id); ordered = _dedupe(body)
    for b in db.scalars(select(SupplierPriceBreak).where(SupplierPriceBreak.supplier_product_id == sp.id)):
        db.delete(b)
    db.flush()
    for b in ordered:
        db.add(SupplierPriceBreak(supplier_product_id=sp.id, min_qty=b.min_qty, unit_price=b.unit_price))
    audit(db, user, "price_breaks.supplier.set", "supplier_product", sp.id, tiers=len(ordered)); db.commit()
    return dict(breaks=[dict(min_qty=b.min_qty, unit_price=b.unit_price) for b in ordered])


# ---- sales price breaks (sell side)
@router.get("/price-breaks/sales/{product_id}")
def get_sales_breaks(product_id: uuid.UUID, customer_id: uuid.UUID | None = None, db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    p = db.get(Product, product_id)
    if not p:
        raise NotFound("Product")
    rows = db.scalars(select(SalesPriceBreak).where(SalesPriceBreak.product_id == product_id, SalesPriceBreak.customer_id == customer_id)
                      .order_by(SalesPriceBreak.min_qty)).all()
    return dict(list_price=p.unit_price, breaks=[dict(min_qty=r.min_qty, unit_price=r.unit_price) for r in rows])


@router.put("/price-breaks/sales/{product_id}")
def put_sales_breaks(product_id: uuid.UUID, body: BreaksIn, customer_id: uuid.UUID | None = None, db: Session = Depends(get_db), user: User = Depends(require("product:write"))):
    if not db.get(Product, product_id):
        raise NotFound("Product")
    ordered = _dedupe(body)
    for b in db.scalars(select(SalesPriceBreak).where(SalesPriceBreak.product_id == product_id, SalesPriceBreak.customer_id == customer_id)):
        db.delete(b)
    db.flush()
    for b in ordered:
        db.add(SalesPriceBreak(product_id=product_id, customer_id=customer_id, min_qty=b.min_qty, unit_price=b.unit_price))
    audit(db, user, "price_breaks.sales.set", "product", product_id, tiers=len(ordered), customer=str(customer_id or "")); db.commit()
    return dict(breaks=[dict(min_qty=b.min_qty, unit_price=b.unit_price) for b in ordered])


@router.get("/pricing/quote")
def quote(product_id: uuid.UUID, quantity: int = Query(ge=1, le=10_000_000), customer_id: uuid.UUID | None = None,
          supplier_id: uuid.UUID | None = None, db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    return pricing.quote(db, product_id, quantity, customer_id, supplier_id)


# ---- replenishment (shortage -> POs)
@router.get("/replenishment/shortages")
def shortages(warehouse_id: uuid.UUID | None = None, take_price_breaks: bool = False, db: Session = Depends(get_db), _: User = Depends(require("inventory:read"))):
    rows = replenishment.shortages(db, warehouse_id, take_price_breaks)
    for r in rows:
        r.pop("avg_daily_demand", None); r.pop("inventory_id", None)
    return rows


@router.post("/replenishment/create-pos", status_code=201)
def create_pos(body: ShortageCreate, db: Session = Depends(get_db), user: User = Depends(require("po:write"))):
    pos, skipped = replenishment.create_pos(db, user, body.warehouse_id, body.product_ids, body.take_price_breaks)
    for po in pos:
        audit(db, user, "po.create_from_shortage", "purchase_order", po.id, po=po.po_number, order_type=po.order_type)
    db.commit()
    return dict(created=[dict(id=po.id, po_number=po.po_number, supplier_name=po.supplier_name, warehouse_name=po.warehouse_name,
                              order_type=po.order_type, total_amount=po.total_amount, lines=len(po.lines)) for po in pos],
                skipped=skipped)
