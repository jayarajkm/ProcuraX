from decimal import Decimal
from sqlalchemy import select
from app.models import Inventory, InventoryMovement, Warehouse
from app.services import pricing

B = "/api/v1"


def test_tier_price_picks_highest_break_not_above_qty():
    br = [(25, Decimal("9")), (100, Decimal("8")), (500, Decimal("7"))]
    base = Decimal("10")
    assert pricing.tier_price(br, 1, base) == 10
    assert pricing.tier_price(br, 25, base) == 9      # break is inclusive
    assert pricing.tier_price(br, 99, base) == 9
    assert pricing.tier_price(br, 100, base) == 8
    assert pricing.tier_price(br, 10_000, base) == 7
    assert pricing.next_break(br, 30) == (100, Decimal("8"))
    assert pricing.next_break(br, 500) is None


def test_warehouse_ownership_seeded(client, auth):
    whs = {w["code"]: w for w in client.get(f"{B}/warehouses", headers=auth("viewer")).json()}
    assert whs["WH-WEST"]["ownership_type"] == "vendor" and whs["WH-WEST"]["owner_name"] != "Own stock"
    assert whs["WH-CENTRAL"]["ownership_type"] == "customer"
    assert whs["WH-NORTH"]["ownership_type"] == "self"


def test_quote_uses_customer_tiers_and_shows_margin(client, auth):
    h = auth("buyer")
    cust = next(c for c in client.get(f"{B}/customers", headers=h).json() if c["segment"] == "key_account")
    sh = client.get(f"{B}/replenishment/shortages", headers=h).json()
    pid = sh[0]["product_id"]
    q1 = client.get(f"{B}/pricing/quote", params=dict(product_id=pid, quantity=1, customer_id=cust["id"]), headers=h).json()
    q500 = client.get(f"{B}/pricing/quote", params=dict(product_id=pid, quantity=500, customer_id=cust["id"]), headers=h).json()
    lst = client.get(f"{B}/pricing/quote", params=dict(product_id=pid, quantity=500), headers=h).json()
    assert Decimal(str(q500["sell_unit_price"])) <= Decimal(str(q1["sell_unit_price"]))
    assert Decimal(str(q500["sell_unit_price"])) <= Decimal(str(lst["sell_unit_price"]))  # contract tier beats list tier
    assert q500["margin_pct"] is not None and q500["margin_pct"] > 0


def test_break_rows_validated(client, auth):
    h = auth("admin")
    pid = client.get(f"{B}/replenishment/shortages", headers=h).json()[0]["product_id"]
    bad = client.put(f"{B}/price-breaks/sales/{pid}", json={"breaks": [{"min_qty": 10, "unit_price": 5}, {"min_qty": 100, "unit_price": 6}]}, headers=h)
    assert bad.status_code == 422  # higher tier costs more
    dup = client.put(f"{B}/price-breaks/sales/{pid}", json={"breaks": [{"min_qty": 10, "unit_price": 5}, {"min_qty": 10, "unit_price": 4}]}, headers=h)
    assert dup.status_code == 422
    assert client.put(f"{B}/price-breaks/sales/{pid}", json={"breaks": [{"min_qty": 10, "unit_price": 5}, {"min_qty": 100, "unit_price": 4}]}, headers=h).status_code == 200
    assert [b["min_qty"] for b in client.get(f"{B}/price-breaks/sales/{pid}", headers=h).json()["breaks"]] == [10, 100]
    assert client.put(f"{B}/price-breaks/sales/{pid}", json={"breaks": []}, headers=auth("viewer")).status_code == 403


def test_shortage_actions_follow_ownership(client, auth):
    rows = client.get(f"{B}/replenishment/shortages", headers=auth("buyer")).json()
    by_wh = {}
    for r in rows:
        by_wh.setdefault(r["ownership_type"], set()).add(r["action"])
    assert by_wh["customer"] == {"notify_customer"}
    assert by_wh["vendor"] <= {"consignment", "no_supplier"} and "consignment" in by_wh["vendor"]
    assert "purchase" in by_wh["self"]
    for r in rows:
        if r["action"] == "purchase":
            assert r["quantity"] >= r["needed_quantity"] and r["unit_price"] is not None


def test_create_pos_for_self_warehouse_uses_break_price(client, auth, tx_db):
    h = auth("buyer")
    north = next(w for w in client.get(f"{B}/warehouses", headers=h).json() if w["code"] == "WH-NORTH")
    rows = [r for r in client.get(f"{B}/replenishment/shortages", params=dict(warehouse_id=north["id"]), headers=h).json() if r["action"] == "purchase"]
    pick = rows[:3]
    r = client.post(f"{B}/replenishment/create-pos", json=dict(warehouse_id=north["id"], product_ids=[p["product_id"] for p in pick]), headers=h)
    assert r.status_code == 201, r.text
    created = r.json()["created"]
    assert created and all(c["order_type"] == "standard" for c in created)
    po = client.get(f"{B}/purchase-orders/{created[0]['id']}", headers=h).json()
    for line in po["lines"]:
        expect = next(p for p in pick if p["product_id"] == line["product_id"])
        assert line["quantity"] == expect["quantity"] and Decimal(str(line["unit_price"])) == Decimal(str(expect["unit_price"]))


def test_customer_owned_warehouse_blocks_po(client, auth):
    h = auth("buyer")
    cen = next(w for w in client.get(f"{B}/warehouses", headers=h).json() if w["code"] == "WH-CENTRAL")
    r = client.post(f"{B}/replenishment/create-pos", json=dict(warehouse_id=cen["id"]), headers=h)
    assert r.status_code == 201 and r.json()["created"] == [] and r.json()["skipped"]
    sup = client.get(f"{B}/suppliers", headers=h).json()["items"][0]
    prod = client.get(f"{B}/products", headers=h).json()["items"][0]
    r = client.post(f"{B}/purchase-orders", json=dict(supplier_id=sup["id"], warehouse_id=cen["id"], lines=[dict(product_id=prod["id"], quantity=5)]), headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "customer_owned_warehouse"


def test_vendor_owned_warehouse_only_owner_and_consignment(client, auth):
    h = auth("buyer")
    west = next(w for w in client.get(f"{B}/warehouses", headers=h).json() if w["code"] == "WH-WEST")
    other = next(s for s in client.get(f"{B}/suppliers", params=dict(page_size=50), headers=h).json()["items"] if s["id"] != west["owner_supplier_id"])
    prod = client.get(f"{B}/products", headers=h).json()["items"][0]
    r = client.post(f"{B}/purchase-orders", json=dict(supplier_id=other["id"], warehouse_id=west["id"], lines=[dict(product_id=prod["id"], quantity=5)]), headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "vendor_owned_warehouse"
    res = client.post(f"{B}/replenishment/create-pos", json=dict(warehouse_id=west["id"]), headers=h)
    assert res.status_code == 201 and res.json()["created"]
    assert all(c["order_type"] == "consignment" and c["supplier_name"] == west["owner_name"] for c in res.json()["created"])


def test_goods_receipt_updates_stock_and_ledger(client, auth, tx_db):
    adm = auth("admin")
    north = next(w for w in client.get(f"{B}/warehouses", headers=adm).json() if w["code"] == "WH-NORTH")
    row = next(r for r in client.get(f"{B}/replenishment/shortages", params=dict(warehouse_id=north["id"]), headers=adm).json() if r["action"] == "purchase")
    po = client.post(f"{B}/replenishment/create-pos", json=dict(warehouse_id=north["id"], product_ids=[row["product_id"]]), headers=adm).json()["created"][0]
    inv = tx_db.scalar(select(Inventory).where(Inventory.product_id == row["product_id"], Inventory.warehouse_id == north["id"]))
    on_hand0, on_order0 = inv.quantity_on_hand, inv.quantity_on_order
    for to in ("pending_approval", "approved"):
        assert client.post(f"{B}/purchase-orders/{po['id']}/status", json=dict(to_status=to), headers=adm).status_code == 200, to
    tx_db.refresh(inv)
    assert inv.quantity_on_order == on_order0 + row["quantity"]  # counted from approval
    assert client.post(f"{B}/purchase-orders/{po['id']}/status", json=dict(to_status="sent"), headers=adm).status_code == 200
    tx_db.refresh(inv)
    assert inv.quantity_on_order == on_order0 + row["quantity"]  # sending must not count it twice
    assert client.post(f"{B}/purchase-orders/{po['id']}/status", json=dict(to_status="received"), headers=adm).status_code == 200
    tx_db.refresh(inv)
    assert inv.quantity_on_hand == on_hand0 + row["quantity"] and inv.quantity_on_order == on_order0
    mv = tx_db.scalars(select(InventoryMovement).where(InventoryMovement.inventory_id == inv.id, InventoryMovement.reference == po["po_number"])).all()
    assert len(mv) == 1 and mv[0].quantity == row["quantity"] and mv[0].movement_type == "receipt"


def test_second_create_does_not_duplicate_open_pos(client, auth):
    h = auth("buyer")
    east = next(w for w in client.get(f"{B}/warehouses", headers=h).json() if w["code"] == "WH-EAST")
    first = client.post(f"{B}/replenishment/create-pos", json=dict(warehouse_id=east["id"]), headers=h).json()
    assert first["created"]
    again = client.post(f"{B}/replenishment/create-pos", json=dict(warehouse_id=east["id"]), headers=h).json()
    assert again["created"] == []  # everything is already on a draft PO
    left = client.get(f"{B}/replenishment/shortages", params=dict(warehouse_id=east["id"]), headers=h).json()
    assert left == []


def test_cancelling_approved_po_releases_on_order(client, auth, tx_db):
    adm = auth("admin")
    west_free = next(w for w in client.get(f"{B}/warehouses", headers=adm).json() if w["code"] == "WH-SOUTH")
    row = next(r for r in client.get(f"{B}/replenishment/shortages", params=dict(warehouse_id=west_free["id"]), headers=adm).json() if r["action"] == "purchase")
    po = client.post(f"{B}/replenishment/create-pos", json=dict(warehouse_id=west_free["id"], product_ids=[row["product_id"]]), headers=adm).json()["created"][0]
    inv = tx_db.scalar(select(Inventory).where(Inventory.product_id == row["product_id"], Inventory.warehouse_id == west_free["id"]))
    base = inv.quantity_on_order
    for to in ("pending_approval", "approved"):
        client.post(f"{B}/purchase-orders/{po['id']}/status", json=dict(to_status=to), headers=adm)
    tx_db.refresh(inv); assert inv.quantity_on_order == base + row["quantity"]
    assert client.post(f"{B}/purchase-orders/{po['id']}/status", json=dict(to_status="cancelled"), headers=adm).status_code == 200
    tx_db.refresh(inv); assert inv.quantity_on_order == base
