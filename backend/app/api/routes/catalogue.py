import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.api.deps import audit, require
from app.core.errors import AppError, NotFound
from app.database.session import get_db
from app.models import (Product, ProductCategory, PurchaseOrder, Supplier, SupplierProduct, User, Warehouse)
from app.repositories.base import paginate
from app.schemas.business import *
from app.schemas.common import Page

router = APIRouter(tags=["catalogue"])
PSORT = {"name": Product.name, "sku": Product.sku, "unit_price": Product.unit_price, "created_at": Product.created_at}
SSORT = {"name": Supplier.name, "code": Supplier.code, "rating": Supplier.rating, "lead_time": Supplier.avg_lead_time_days, "country": Supplier.country}


def _commit(db: Session, what: str):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError("conflict", f"{what} violates a uniqueness or integrity constraint", 409)


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    return db.scalars(select(ProductCategory).order_by(ProductCategory.name)).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db), user: User = Depends(require("product:write"))):
    c = ProductCategory(organization_id=user.organization_id, **body.model_dump())
    db.add(c); _commit(db, "Category")
    return c


@router.get("/products", response_model=Page[ProductOut])
def list_products(q: str | None = None, category_id: uuid.UUID | None = None, active: bool | None = None,
                  page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200), sort: str | None = "name",
                  order: str = Query("asc", pattern="^(asc|desc)$"), db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    stmt = select(Product)
    if q:
        like = f"%{q}%"; stmt = stmt.where(or_(Product.name.ilike(like), Product.sku.ilike(like), Product.manufacturer.ilike(like)))
    if category_id: stmt = stmt.where(Product.category_id == category_id)
    if active is not None: stmt = stmt.where(Product.is_active == active)
    return paginate(db, stmt, page, page_size, PSORT, sort, order, Product.name)


@router.get("/products/{pid}", response_model=ProductOut)
def get_product(pid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    p = db.get(Product, pid)
    if not p: raise NotFound("Product")
    return p


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(body: ProductIn, db: Session = Depends(get_db), user: User = Depends(require("product:write"))):
    if not db.get(ProductCategory, body.category_id): raise AppError("invalid_category", "Category does not exist", 422)
    p = Product(organization_id=user.organization_id, **body.model_dump())
    db.add(p); audit(db, user, "product.create", "product", p.id, sku=body.sku); _commit(db, "Product")
    return p


@router.patch("/products/{pid}", response_model=ProductOut)
def update_product(pid: uuid.UUID, body: ProductUpdate, db: Session = Depends(get_db), user: User = Depends(require("product:write"))):
    p = db.get(Product, pid)
    if not p: raise NotFound("Product")
    for k, v in body.model_dump(exclude_unset=True).items(): setattr(p, k, v)
    audit(db, user, "product.update", "product", pid); _commit(db, "Product"); db.refresh(p)
    return p


@router.delete("/products/{pid}", status_code=204)
def delete_product(pid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require("product:write"))):
    p = db.get(Product, pid)
    if not p: raise NotFound("Product")
    db.delete(p); audit(db, user, "product.delete", "product", pid)
    try: db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError("in_use", "Product is referenced by orders/requests; deactivate it instead", 409)


@router.get("/suppliers", response_model=Page[SupplierOut])
def list_suppliers(q: str | None = None, country: str | None = None, active: bool | None = None, page: int = Query(1, ge=1),
                   page_size: int = Query(25, ge=1, le=200), sort: str | None = "name", order: str = Query("asc", pattern="^(asc|desc)$"),
                   db: Session = Depends(get_db), _: User = Depends(require("supplier:read"))):
    stmt = select(Supplier)
    if q: stmt = stmt.where(or_(Supplier.name.ilike(f"%{q}%"), Supplier.code.ilike(f"%{q}%")))
    if country: stmt = stmt.where(Supplier.country == country)
    if active is not None: stmt = stmt.where(Supplier.is_active == active)
    return paginate(db, stmt, page, page_size, SSORT, sort, order, Supplier.name)


@router.get("/suppliers/{sid}", response_model=SupplierOut)
def get_supplier(sid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("supplier:read"))):
    s = db.get(Supplier, sid)
    if not s: raise NotFound("Supplier")
    return s


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
def create_supplier(body: SupplierIn, db: Session = Depends(get_db), user: User = Depends(require("supplier:write"))):
    s = Supplier(organization_id=user.organization_id, **{**body.model_dump(), "email": body.email or ""})
    db.add(s); audit(db, user, "supplier.create", "supplier", s.id); _commit(db, "Supplier")
    return s


@router.patch("/suppliers/{sid}", response_model=SupplierOut)
def update_supplier(sid: uuid.UUID, body: SupplierUpdate, db: Session = Depends(get_db), user: User = Depends(require("supplier:write"))):
    s = db.get(Supplier, sid)
    if not s: raise NotFound("Supplier")
    for k, v in body.model_dump(exclude_unset=True).items(): setattr(s, k, v)
    audit(db, user, "supplier.update", "supplier", sid); _commit(db, "Supplier"); db.refresh(s)
    return s


@router.get("/suppliers/{sid}/products", response_model=list[SupplierProductOut])
def supplier_products(sid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("supplier:read"))):
    rows = db.execute(select(SupplierProduct, Product).join(Product).where(SupplierProduct.supplier_id == sid).order_by(Product.name)).all()
    return [SupplierProductOut(product_id=p.id, sku=p.sku, product_name=p.name, unit_price=sp.unit_price, lead_time_days=sp.lead_time_days,
                               min_order_qty=sp.min_order_qty, is_preferred=sp.is_preferred) for sp, p in rows]


@router.get("/suppliers/{sid}/performance")
def supplier_performance(sid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("supplier:read"))):
    s = db.get(Supplier, sid)
    if not s: raise NotFound("Supplier")
    rec = [o for o in db.scalars(select(PurchaseOrder).where(PurchaseOrder.supplier_id == sid, PurchaseOrder.status == "received"))]
    on_time = [o for o in rec if o.actual_delivery_date and o.actual_delivery_date <= o.expected_delivery_date]
    delays = [(o.actual_delivery_date - o.expected_delivery_date).days for o in rec if o.actual_delivery_date]
    return {"supplier_id": sid, "rating": float(s.rating), "orders_received": len(rec),
            "on_time_rate": round(len(on_time) / len(rec), 3) if rec else None,
            "avg_delay_days": round(sum(delays) / len(delays), 2) if delays else None,
            "total_orders": db.scalar(select(func.count()).select_from(PurchaseOrder).where(PurchaseOrder.supplier_id == sid))}


@router.get("/suppliers/{sid}/purchase-orders", response_model=list[POOut])
def supplier_pos(sid: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("po:read"))):
    return db.scalars(select(PurchaseOrder).where(PurchaseOrder.supplier_id == sid).order_by(PurchaseOrder.order_date.desc())).all()


@router.get("/suppliers-meta/countries", response_model=list[str])
def supplier_countries(db: Session = Depends(get_db), _: User = Depends(require("supplier:read"))):
    return [c for (c,) in db.execute(select(Supplier.country).distinct().order_by(Supplier.country)) if c]


@router.get("/warehouses", response_model=list[WarehouseOut])
def warehouses(db: Session = Depends(get_db), _: User = Depends(require("inventory:read"))):
    return db.scalars(select(Warehouse).order_by(Warehouse.code)).all()
