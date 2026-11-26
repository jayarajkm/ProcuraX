"""Distributor demo layer: customers, warehouse ownership, buy and sell price breaks. Idempotent and deterministic.

Run on an existing database with:  python -m app.database.seed --distribution
"""
import random
from decimal import Decimal
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.models import (Customer, Product, SalesPriceBreak, Supplier, SupplierPriceBreak, SupplierProduct, Warehouse)

CUSTOMERS = [("CUS-HARTWELL", "Hartwell Retail Group", "key_account"), ("CUS-BRIGHTON", "Brighton Builders Merchants", "contract"),
             ("CUS-NORTHFIELD", "Northfield Facilities Services", "contract"), ("CUS-ALDER", "Alder & Finch Hardware", "standard"),
             ("CUS-PENNINE", "Pennine Trade Supplies", "standard"), ("CUS-COASTAL", "Coastal Maintenance Ltd", "standard")]
LIST_TIERS = [(25, Decimal("0.95")), (100, Decimal("0.90")), (500, Decimal("0.85"))]
SEGMENT_TIERS = {"key_account": [(1, "0.93"), (25, "0.88"), (100, "0.83"), (500, "0.78")],
                 "contract": [(1, "0.96"), (25, "0.91"), (100, "0.86"), (500, "0.82")]}


def q2(x) -> Decimal:
    return Decimal(x).quantize(Decimal("0.01"))


def seed_distribution(db: Session, org, seed: int = 42) -> dict:
    rng = random.Random(seed + 99)
    have = {c.code: c for c in db.scalars(select(Customer))}
    for code, name, seg in CUSTOMERS:
        if code not in have:
            c = Customer(organization_id=org.id, code=code, name=name, segment=seg, contact_person="Buying Desk",
                         email=f"orders@{code.split('-')[1].lower()}.example")
            db.add(c); have[code] = c
    db.flush()

    # warehouse ownership: West = vendor-owned (consignment, vendor with the widest range), Central = customer-owned
    whs = {w.code: w for w in db.scalars(select(Warehouse))}
    top_supplier = db.execute(select(Supplier.id).join(SupplierProduct, SupplierProduct.supplier_id == Supplier.id)
                              .where(Supplier.is_active).group_by(Supplier.id).order_by(func.count().desc(), Supplier.id).limit(1)).scalar()
    if "WH-WEST" in whs and whs["WH-WEST"].ownership_type == "self":
        whs["WH-WEST"].ownership_type = "vendor"; whs["WH-WEST"].owner_supplier_id = top_supplier
        whs["WH-WEST"].name = "West Consignment Warehouse"
    if "WH-CENTRAL" in whs and whs["WH-CENTRAL"].ownership_type == "self":
        whs["WH-CENTRAL"].ownership_type = "customer"; whs["WH-CENTRAL"].owner_customer_id = have["CUS-HARTWELL"].id
        whs["WH-CENTRAL"].name = "Central Fulfilment (Hartwell stock)"
    db.flush()

    # buy side: two supplier tiers per supplier product
    n_buy = 0
    existing = {b.supplier_product_id for b in db.scalars(select(SupplierPriceBreak))}
    prices = {p.id: p.unit_price for p in db.scalars(select(Product))}
    for sp in db.scalars(select(SupplierProduct).order_by(SupplierProduct.id)):
        if sp.id in existing:
            continue
        # a distributor buys below its list price: cost is 60-78% of list so every sell tier keeps a positive margin
        sp.unit_price = q2(prices[sp.product_id] * Decimal(str(rng.uniform(0.60, 0.78))))
        base = sp.unit_price
        t1 = max(sp.min_order_qty * 2, rng.choice([25, 50, 60]))
        t2 = t1 * rng.choice([3, 4, 5])
        db.add(SupplierPriceBreak(supplier_product_id=sp.id, min_qty=t1, unit_price=q2(base * Decimal(str(rng.uniform(0.93, 0.96))))))
        db.add(SupplierPriceBreak(supplier_product_id=sp.id, min_qty=t2, unit_price=q2(base * Decimal(str(rng.uniform(0.85, 0.90))))))
        n_buy += 2

    if n_buy:  # costs were repriced, so the preferred supplier (cheapest) must be recomputed: exactly one per product
        db.flush()
        by_product: dict = {}
        for sp in db.scalars(select(SupplierProduct).order_by(SupplierProduct.id)):
            by_product.setdefault(sp.product_id, []).append(sp)
        for plist in by_product.values():
            best = min(plist, key=lambda x: x.unit_price)
            for sp in plist:
                sp.is_preferred = sp is best

    # sell side: list tiers for every product, contract tiers for every product for each contract/key-account customer
    n_sell = 0
    have_sales = {(b.product_id, b.customer_id) for b in db.scalars(select(SalesPriceBreak))}
    products = list(db.scalars(select(Product).order_by(Product.sku)))
    for p in products:
        if (p.id, None) not in have_sales:
            for mq, f in LIST_TIERS:
                db.add(SalesPriceBreak(product_id=p.id, customer_id=None, min_qty=mq, unit_price=q2(p.unit_price * f))); n_sell += 1
    for code, c in have.items():
        tiers = SEGMENT_TIERS.get(c.segment)
        if not tiers:
            continue
        for p in products:
            if (p.id, c.id) in have_sales:
                continue
            for mq, f in tiers:
                db.add(SalesPriceBreak(product_id=p.id, customer_id=c.id, min_qty=mq, unit_price=q2(p.unit_price * Decimal(f)))); n_sell += 1
    db.flush()
    return dict(customers=len(have), supplier_breaks_added=n_buy, sales_breaks_added=n_sell)
