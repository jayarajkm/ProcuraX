"""Quantity price breaks (buy side and sell side).

A break row says: "from min_qty units upward the unit price is X". The price for a quantity is the row with the
highest min_qty that is <= quantity; below the lowest break the base price applies.
Sell price: a customer's own tiers (contract pricing) override the list tiers; with neither, products.unit_price.
"""
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.errors import NotFound
from app.models import Customer, Product, SalesPriceBreak, Supplier, SupplierPriceBreak, SupplierProduct

CENT = Decimal("0.01")


def q2(x) -> Decimal:
    return Decimal(x).quantize(CENT)


def tier_price(breaks: list[tuple[int, Decimal]], qty: int, base: Decimal) -> Decimal:
    price = base
    for min_qty, unit in sorted(breaks):
        if qty >= min_qty:
            price = unit
    return Decimal(price)


def next_break(breaks: list[tuple[int, Decimal]], qty: int) -> tuple[int, Decimal] | None:
    higher = sorted(b for b in breaks if b[0] > qty)
    return higher[0] if higher else None


def supplier_breaks(db: Session, supplier_product_id) -> list[tuple[int, Decimal]]:
    return [(b.min_qty, b.unit_price) for b in db.scalars(
        select(SupplierPriceBreak).where(SupplierPriceBreak.supplier_product_id == supplier_product_id))]


def supplier_unit_price(db: Session, sp: SupplierProduct, qty: int) -> Decimal:
    return tier_price(supplier_breaks(db, sp.id), qty, sp.unit_price)


def sales_breaks(db: Session, product_id, customer_id=None) -> list[tuple[int, Decimal]]:
    """Customer tiers if that customer has any for the product, otherwise list tiers."""
    if customer_id:
        own = [(b.min_qty, b.unit_price) for b in db.scalars(select(SalesPriceBreak).where(
            SalesPriceBreak.product_id == product_id, SalesPriceBreak.customer_id == customer_id))]
        if own:
            return own
    return [(b.min_qty, b.unit_price) for b in db.scalars(select(SalesPriceBreak).where(
        SalesPriceBreak.product_id == product_id, SalesPriceBreak.customer_id.is_(None)))]


def sell_unit_price(db: Session, product: Product, qty: int, customer_id=None) -> Decimal:
    return tier_price(sales_breaks(db, product.id, customer_id), qty, product.unit_price)


def quote(db: Session, product_id, qty: int, customer_id=None, supplier_id=None) -> dict:
    """Sell price for qty (to a customer) versus the best buy cost at that quantity, with margin and the next break."""
    product = db.get(Product, product_id)
    if not product:
        raise NotFound("Product")
    customer = db.get(Customer, customer_id) if customer_id else None
    if customer_id and not customer:
        raise NotFound("Customer")
    sb = sales_breaks(db, product.id, customer_id)
    sell = tier_price(sb, qty, product.unit_price)
    # buy cost: chosen supplier, else the cheapest active supplier at this quantity
    stmt = select(SupplierProduct, Supplier).join(Supplier).where(SupplierProduct.product_id == product.id, Supplier.is_active)
    if supplier_id:
        stmt = stmt.where(SupplierProduct.supplier_id == supplier_id)
    best = None
    for sp, sup in db.execute(stmt).all():
        cost = supplier_unit_price(db, sp, qty)
        if best is None or cost < best[0]:
            best = (cost, sp, sup)
    nb = next_break(sb, qty)
    out = dict(product_id=product.id, sku=product.sku, product_name=product.name, quantity=qty,
               customer=customer.name if customer else None, list_price=product.unit_price,
               sell_unit_price=sell, sell_total=q2(sell * qty),
               sell_breaks=[dict(min_qty=m, unit_price=p) for m, p in sorted(sb)],
               next_sell_break=dict(min_qty=nb[0], unit_price=nb[1]) if nb else None,
               cost_unit_price=None, cost_total=None, supplier_name=None, margin=None, margin_pct=None)
    if best:
        cost, sp, sup = best
        margin = sell - cost
        out.update(cost_unit_price=cost, cost_total=q2(cost * qty), supplier_name=sup.name, margin=q2(margin * qty),
                   margin_pct=float(round(margin / sell * 100, 1)) if sell > 0 else None)
    return out
