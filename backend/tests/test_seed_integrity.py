from decimal import Decimal
from sqlalchemy import func, select, text
from app.database.health import check_database
from app.models import *  # noqa


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_health(db):
    h = check_database(db)
    assert h["pgvector"] and h["migration"] == "0001"


def test_target_counts(db):
    assert count(db, Product) == 200
    assert count(db, Supplier) == 30
    assert count(db, Warehouse) == 5
    assert count(db, Inventory) == 1000
    assert count(db, DemandHistory) >= 5000
    assert count(db, PurchaseOrder) == 150
    assert count(db, PurchaseOrderLine) == 400
    assert count(db, PurchaseRequest) == 100
    assert count(db, SupplierMessage) == 300
    assert count(db, Document) == 10
    assert count(db, User) == 4 and count(db, Role) == 4
    assert count(db, ChatbotType) == 6


def test_scenarios_present(db):
    low = db.scalar(select(func.count()).select_from(Inventory).where(Inventory.quantity_on_hand - Inventory.quantity_reserved <= Inventory.reorder_level))
    assert 50 < low < 500  # some below, many healthy
    healthy = count(db, Inventory) - low
    assert healthy > 300
    delayed = db.scalar(text("select count(*) from purchase_orders where status in ('sent','partially_received') and expected_delivery_date < current_date"))
    assert delayed > 0
    assert db.scalar(select(func.count()).select_from(PurchaseRequest).where(PurchaseRequest.status == "pending_approval")) > 0
    assert len({m for (m,) in db.execute(select(SupplierMessage.label).distinct())}) == 6


def test_po_totals_consistent(db):
    for po in db.scalars(select(PurchaseOrder)):
        sub = sum(l.quantity * l.unit_price for l in po.lines)
        assert abs(po.subtotal - sub) <= Decimal("0.05"), po.po_number
        assert po.total_amount == po.subtotal + po.tax_amount
        for l in po.lines:
            assert abs(l.line_total - l.quantity * l.unit_price) <= Decimal("0.01")
            assert 0 <= l.quantity_received <= l.quantity


def test_po_lines_match_supplier_catalogue(db):
    bad = db.scalar(text("""select count(*) from purchase_order_lines l join purchase_orders o on o.id=l.purchase_order_id
        left join supplier_products sp on sp.supplier_id=o.supplier_id and sp.product_id=l.product_id where sp.id is null"""))
    assert bad == 0


def test_on_order_derived_from_open_pos(db):
    mism = db.scalar(text("""
      with open_qty as (select l.product_id, o.warehouse_id, sum(l.quantity-l.quantity_received) q
        from purchase_order_lines l join purchase_orders o on o.id=l.purchase_order_id
        where o.status in ('approved','sent','partially_received') group by 1,2)
      select count(*) from inventory i left join open_qty q on q.product_id=i.product_id and q.warehouse_id=i.warehouse_id
      where i.quantity_on_order <> coalesce(q.q,0)"""))
    assert mism == 0


def test_inventory_invariants(db):
    assert db.scalar(text("select count(*) from inventory where quantity_reserved > quantity_on_hand")) == 0
    assert db.scalar(text("select count(*) from (select product_id,warehouse_id from inventory group by 1,2 having count(*)>1) x")) == 0


def test_every_product_has_suppliers_and_one_preferred(db):
    r = db.execute(text("select count(*) from products p where (select count(*) from supplier_products where product_id=p.id) < 2 "
                        "or (select count(*) from supplier_products where product_id=p.id and is_preferred) <> 1")).scalar()
    assert r == 0


def test_converted_requests_link_to_pos(db):
    assert db.scalar(text("select count(*) from purchase_requests r where status='converted' and not exists (select 1 from purchase_orders where source_request_id=r.id)")) == 0


def test_demo_users_have_roles(db):
    u = db.scalar(select(User).where(User.email == "buyer@procurax.demo"))
    assert [r.name for r in u.roles] == ["Buyer"]
    assert "po:approve" not in {p.code for p in u.roles[0].permissions}
    admin = db.scalar(select(User).where(User.email == "admin@procurax.demo"))
    assert "admin:manage" in {p.code for p in admin.roles[0].permissions}


def test_unique_constraints_enforced(db):
    import pytest
    from sqlalchemy.exc import IntegrityError
    p = db.scalar(select(Product).limit(1))
    db.add(Product(organization_id=p.organization_id, category_id=p.category_id, sku=p.sku, name="dup", unit_price=Decimal("1")))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
