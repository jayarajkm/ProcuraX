"""Closed registry of agent tools. Every tool: Pydantic-validated args, permission check, runs through backend services.
There is deliberately no SQL, shell, or approval tool: the agent can only prepare work for humans to approve."""
import uuid
from dataclasses import dataclass
from typing import Callable
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.deps import user_permissions
from app.models import AgentToolRegistry, Inventory, Product, PurchaseOrder, Supplier, SupplierProduct, User
from app.schemas.business import RequestCreate, RequestLineIn
from app.services import inventory as inv_svc
from app.services import procurement as proc
from app.services import queries as q


class ToolError(Exception):
    pass


class SearchProducts(BaseModel):
    query: str = Field(min_length=1, max_length=100); limit: int = Field(default=10, ge=1, le=20)
class GetInventory(BaseModel):
    product_id: uuid.UUID | None = None; sku: str | None = None
class LowStock(BaseModel):
    within_days: float | None = Field(default=None, ge=0, le=365, description="only items whose available stock covers <= this many days of demand")
    limit: int = Field(default=15, ge=1, le=30)
class SearchSuppliers(BaseModel):
    query: str = Field(default="", max_length=100); country: str | None = None; limit: int = Field(default=10, ge=1, le=20)
class SupplierProducts(BaseModel):
    supplier_id: uuid.UUID; limit: int = Field(default=15, ge=1, le=30)
class ProductOnly(BaseModel):
    product_id: uuid.UUID
class ReorderArgs(BaseModel):
    product_id: uuid.UUID | None = None
    product_ids: list[uuid.UUID] | None = Field(default=None, max_length=10, description="batch several products in ONE call")
class PoStatus(BaseModel):
    po_number: str | None = None; status: str | None = None; limit: int = Field(default=10, ge=1, le=20)
class PRLine(BaseModel):
    product_id: uuid.UUID; quantity: int = Field(gt=0, le=100000); supplier_id: uuid.UUID
class CreatePR(BaseModel):
    justification: str = Field(min_length=5, max_length=500); priority: str = Field(default="medium", pattern="^(low|medium|high|urgent)$")
    lines: list[PRLine] = Field(min_length=1, max_length=25)
class SubmitPR(BaseModel):
    request_id: uuid.UUID


def _inv_rows(db, product_id=None, sku=None):
    stmt = select(Inventory).join(Product, Product.id == Inventory.product_id)
    if product_id: stmt = stmt.where(Inventory.product_id == product_id)
    elif sku: stmt = stmt.where(Product.sku == sku)
    else: raise ToolError("Provide product_id or sku")
    return list(db.scalars(stmt).unique())


def t_search_products(db, user, a: SearchProducts):
    return {"products": [{"product_id": str(p.id), "sku": p.sku, "name": p.name, "category": p.category.name, "unit_price": str(p.unit_price)} for p in q.find_products(db, a.query, a.limit)]}


def t_get_inventory(db, user, a: GetInventory):
    rows = _inv_rows(db, a.product_id, a.sku)
    return {"inventory": [{k: (str(v) if k.endswith("id") else v) for k, v in inv_svc.to_out(i).items() if k not in ("updated_at", "avg_daily_demand")} | {"avg_daily_demand": float(i.avg_daily_demand)} for i in rows]}


def t_low_stock(db, user, a: LowStock):
    total, rows = q.low_stock(db, limit=a.limit, max_days_cover=a.within_days)
    return {"total_matching": total, "items": [{"product_id": str(r["product_id"]), "sku": r["sku"], "name": r["product_name"], "warehouse_id": str(r["warehouse_id"]),
            "warehouse": r["warehouse"], "available": r["available"], "projected": r["projected"], "avg_daily_demand": float(r["avg_daily_demand"]),
            "days_of_cover": r["days_of_cover"], "reorder_level": r["reorder_level"]} for r in rows]}


def t_search_suppliers(db, user, a: SearchSuppliers):
    stmt = select(Supplier).where(Supplier.is_active)
    if a.query: stmt = stmt.where(Supplier.name.ilike(f"%{a.query}%") | Supplier.code.ilike(f"%{a.query}%"))
    if a.country: stmt = stmt.where(Supplier.country == a.country)
    return {"suppliers": [{"supplier_id": str(s.id), "code": s.code, "name": s.name, "country": s.country, "rating": float(s.rating), "avg_lead_time_days": s.avg_lead_time_days}
                          for s in db.scalars(stmt.limit(a.limit))]}


def t_supplier_products(db, user, a: SupplierProducts):
    rows = db.execute(select(SupplierProduct, Product).join(Product).where(SupplierProduct.supplier_id == a.supplier_id).limit(a.limit)).all()
    return {"offers": [{"product_id": str(p.id), "sku": p.sku, "name": p.name, "unit_price": str(sp.unit_price), "lead_time_days": sp.lead_time_days, "min_order_qty": sp.min_order_qty} for sp, p in rows]}


def _offers(db, product_id):
    return [{"supplier_id": str(s.id), "supplier": s.name, "rating": float(s.rating), "unit_price": str(sp.unit_price), "lead_time_days": sp.lead_time_days,
             "min_order_qty": sp.min_order_qty, "preferred": sp.is_preferred, "active": s.is_active} for sp, s in q.supplier_offers(db, product_id)]


def t_lead_times(db, user, a: ProductOnly):
    return {"lead_times": [{k: o[k] for k in ("supplier_id", "supplier", "lead_time_days", "active")} for o in _offers(db, a.product_id)]}


def t_compare_prices(db, user, a: ProductOnly):
    offers = _offers(db, a.product_id)
    return {"offers_cheapest_first": offers, "cheapest_active": next((o for o in offers if o["active"]), None)}


def t_reorder_qty(db, user, a: ReorderArgs):
    if a.product_ids:
        return {"results": [{"product_id": str(pid), **_reorder_one(db, pid)} if _ok(db, pid) else {"product_id": str(pid), "error": "No active supplier offers this product"} for pid in a.product_ids]}
    if not a.product_id:
        raise ToolError("Provide product_id or product_ids")
    return _reorder_one(db, a.product_id)


def _ok(db, pid) -> bool:
    return inv_svc.best_supplier_for(db, pid) is not None


def _reorder_one(db, product_id):
    rd = inv_svc.review_days(db)
    best = inv_svc.best_supplier_for(db, product_id)
    if not best: raise ToolError("No active supplier offers this product")
    sp, s = best
    out = []
    for i in _inv_rows(db, product_id):
        out.append({"warehouse": i.warehouse.name, "available": inv_svc.available(i), "projected": inv_svc.projected(i),
                    "suggested_quantity": inv_svc.reorder_quantity(i.avg_daily_demand, sp.lead_time_days, i.safety_stock, inv_svc.projected(i), rd, sp.min_order_qty)})
    return {"supplier_id": str(s.id), "supplier": s.name, "unit_price": str(sp.unit_price), "lead_time_days": sp.lead_time_days, "min_order_qty": sp.min_order_qty,
            "review_days": rd, "formula": "ceil(avg_daily_demand*(lead_time+review_days)+safety_stock-projected), min MOQ", "per_warehouse": out,
            "total_suggested_quantity": sum(o["suggested_quantity"] for o in out)}


def t_po_status(db, user, a: PoStatus):
    stmt = select(PurchaseOrder)
    if a.po_number: stmt = stmt.where(PurchaseOrder.po_number == a.po_number.upper())
    if a.status: stmt = stmt.where(PurchaseOrder.status == a.status)
    pos = list(db.scalars(stmt.order_by(PurchaseOrder.expected_delivery_date).limit(a.limit)))
    return {"purchase_orders": [{"po_number": p.po_number, "status": p.status, "expected_delivery": str(p.expected_delivery_date), "total": str(p.total_amount)} for p in pos]}


def t_create_pr(db, user, a: CreatePR, execution_id=None):
    for l in a.lines:
        if not db.scalar(select(SupplierProduct.id).where(SupplierProduct.supplier_id == l.supplier_id, SupplierProduct.product_id == l.product_id)):
            raise ToolError(f"Supplier {l.supplier_id} does not offer product {l.product_id}")
    data = RequestCreate(justification=a.justification, priority=a.priority, lines=[RequestLineIn(product_id=l.product_id, quantity=l.quantity, suggested_supplier_id=l.supplier_id) for l in a.lines])
    r = proc.create_request(db, user, data)
    r.created_by_agent_execution_id = execution_id
    return {"request_id": str(r.id), "request_number": r.request_number, "status": r.status, "lines": len(r.lines)}


def t_submit_pr(db, user, a: SubmitPR, execution_id=None):
    from app.models import PurchaseRequest
    r = db.get(PurchaseRequest, a.request_id)
    if not r: raise ToolError("Purchase request not found")
    r = proc.submit_request(db, user, r)
    return {"request_number": r.request_number, "status": r.status}


@dataclass
class Tool:
    name: str; description: str; args: type[BaseModel]; permission: str; sensitive: bool; fn: Callable


TOOLS = [
    Tool("search_products", "Search products by name/SKU.", SearchProducts, "product:read", False, t_search_products),
    Tool("get_inventory", "Inventory levels per warehouse for one product (product_id or sku).", GetInventory, "inventory:read", False, t_get_inventory),
    Tool("get_low_stock_items", "Stock records at/below reorder level, optionally only those with <= within_days of cover. Returns product_id and warehouse_id.", LowStock, "inventory:read", False, t_low_stock),
    Tool("search_suppliers", "Search active suppliers by name/code/country.", SearchSuppliers, "supplier:read", False, t_search_suppliers),
    Tool("get_supplier_products", "Products a supplier offers with price/lead time/MOQ.", SupplierProducts, "supplier:read", False, t_supplier_products),
    Tool("get_supplier_lead_times", "Lead times of every supplier of a product.", ProductOnly, "supplier:read", False, t_lead_times),
    Tool("calculate_reorder_quantity", "Suggested reorder quantity using the documented formula and best supplier. Pass product_ids (up to 10) to batch.", ReorderArgs, "inventory:read", False, t_reorder_qty),
    Tool("compare_supplier_prices", "All supplier offers for a product, cheapest first.", ProductOnly, "supplier:read", False, t_compare_prices),
    Tool("get_purchase_order_status", "Look up purchase orders by po_number and/or status.", PoStatus, "po:read", False, t_po_status),
    Tool("create_purchase_request", "SENSITIVE (needs human approval). Create ONE DRAFT purchase request with several lines (product_id, quantity, supplier_id).", CreatePR, "request:write", True, t_create_pr),
    Tool("submit_purchase_request", "SENSITIVE (needs human approval). Submit a draft purchase request into the approval workflow.", SubmitPR, "request:write", True, t_submit_pr),
]
REGISTRY = {t.name: t for t in TOOLS}


def specs() -> list[dict]:
    return [{"name": t.name, "description": t.description, "input_schema": t.args.model_json_schema(), "required_permission": t.permission, "sensitive": t.sensitive} for t in TOOLS]


def sync_registry(db: Session):
    """Mirror code-defined tools into agent_tool_registry (code is the source of truth; is_enabled stays admin-controlled)."""
    rows = {r.name: r for r in db.scalars(select(AgentToolRegistry))}
    for t in TOOLS:
        r = rows.get(t.name) or AgentToolRegistry(name=t.name, is_enabled=True)
        r.description, r.input_schema, r.required_permission, r.is_sensitive = t.description, t.args.model_json_schema(), t.permission, t.sensitive
        db.add(r)
    db.flush()


def validate_call(db: Session, user: User, name: str, raw: dict) -> tuple[Tool, BaseModel]:
    t = REGISTRY.get(name)
    if not t: raise ToolError(f"Unknown tool '{name}'. Available: {', '.join(REGISTRY)}")
    row = db.scalar(select(AgentToolRegistry).where(AgentToolRegistry.name == name))
    if row is not None and not row.is_enabled: raise ToolError(f"Tool '{name}' is disabled by an administrator")
    if t.permission not in user_permissions(user): raise ToolError(f"User lacks permission '{t.permission}' required by tool '{name}'")
    try:
        return t, t.args.model_validate(raw or {})
    except ValidationError as e:
        raise ToolError("Invalid arguments: " + "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:5]))


def execute(db: Session, user: User, tool: Tool, args: BaseModel, execution_id=None) -> dict:
    try:
        return tool.fn(db, user, args, execution_id) if tool.sensitive else tool.fn(db, user, args)
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"{type(e).__name__}: {str(e)[:200]}")
