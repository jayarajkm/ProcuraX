from decimal import Decimal
from sqlalchemy import func, select
from app.models import Product, Supplier, Inventory, PurchaseOrder
from app.services import inventory as inv
from app.services.procurement import calc_totals

B = "/api/v1"


def test_login_and_me(client, auth):
    h = auth("buyer")
    me = client.get(f"{B}/auth/me", headers=h).json()
    assert me["roles"] == ["Buyer"] and "po:approve" not in me["permissions"]


def test_login_failure_and_unauthenticated(client):
    r = client.post(f"{B}/auth/login", json={"email": "admin@procurax.demo", "password": "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
    r = client.get(f"{B}/products")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthenticated"
    assert client.get(f"{B}/products", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_product_list_pagination_search_sort(client, auth):
    h = auth("viewer")
    r = client.get(f"{B}/products?page=2&page_size=50&sort=unit_price&order=desc", headers=h).json()
    assert r["total"] == 200 and len(r["items"]) == 50 and r["page"] == 2
    prices = [Decimal(p["unit_price"]) for p in r["items"]]
    assert prices == sorted(prices, reverse=True)
    q = client.get(f"{B}/products?q=Hex Bolt", headers=h).json()
    assert 0 < q["total"] < 200 and all("hex bolt" in p["name"].lower() for p in q["items"])
    assert client.get(f"{B}/products?sort=;drop table", headers=h).status_code == 200  # unknown sort ignored safely


def test_product_crud_and_rbac(client, auth):
    cat = client.get(f"{B}/categories", headers=auth("viewer")).json()[0]["id"]
    body = {"sku": "TST-0001", "name": "Test Item", "category_id": cat, "unit_price": "9.50"}
    assert client.post(f"{B}/products", json=body, headers=auth("viewer")).status_code == 403
    r = client.post(f"{B}/products", json=body, headers=auth("buyer"))
    assert r.status_code == 403  # buyers cannot write products
    r = client.post(f"{B}/products", json=body, headers=auth("manager"))
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.post(f"{B}/products", json=body, headers=auth("manager")).status_code == 409  # duplicate SKU
    assert client.patch(f"{B}/products/{pid}", json={"unit_price": "11"}, headers=auth("manager")).json()["unit_price"] == "11.00"
    assert client.patch(f"{B}/products/{pid}", json={"unit_price": "-1"}, headers=auth("manager")).status_code == 422
    assert client.delete(f"{B}/products/{pid}", headers=auth("manager")).status_code == 204
    assert client.get(f"{B}/products/{pid}", headers=auth("manager")).status_code == 404


def test_validation_error_format(client, auth):
    r = client.post(f"{B}/products", json={"sku": ""}, headers=auth("manager"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_supplier_endpoints(client, auth):
    h = auth("viewer")
    s = client.get(f"{B}/suppliers?page_size=5", headers=h).json()
    assert s["total"] == 30
    sid = s["items"][0]["id"]
    assert len(client.get(f"{B}/suppliers/{sid}/products", headers=h).json()) > 0
    perf = client.get(f"{B}/suppliers/{sid}/performance", headers=h).json()
    assert "on_time_rate" in perf


def test_inventory_formulas():
    class I: quantity_on_hand = 100; quantity_reserved = 20; quantity_on_order = 50; avg_daily_demand = Decimal("8"); reorder_level = 90
    assert inv.available(I) == 80 and inv.projected(I) == 130 and inv.days_of_cover(I) == 10.0 and inv.is_low_stock(I)
    # 8/day * (14+7) + 40 - 130 = 78
    assert inv.reorder_quantity(8, 14, 40, 130, 7) == 78
    assert inv.reorder_quantity(8, 14, 40, 500, 7) == 0
    assert inv.reorder_quantity(8, 14, 40, 130, 7, min_order_qty=100) == 100  # MOQ floor
    assert inv.reorder_quantity(0, 14, 0, 0, 7) == 0


def test_inventory_api_and_recommendations(client, auth, tx_db):
    h = auth("viewer")
    low = client.get(f"{B}/inventory?low_stock=true&page_size=200", headers=h).json()
    assert low["total"] > 0 and all(i["low_stock"] and i["available"] <= i["reorder_level"] for i in low["items"])
    recs = client.get(f"{B}/inventory/reorder-recommendations", headers=h).json()
    assert recs and all(r["suggested_quantity"] > 0 for r in recs)
    assert client.post(f"{B}/inventory/{low['items'][0]['id']}/adjust", json={"quantity": 5, "reason": "x"}, headers=h).status_code == 403
    adj = client.post(f"{B}/inventory/{low['items'][0]['id']}/adjust", json={"quantity": 5, "reason": "cycle count"}, headers=auth("buyer"))
    assert adj.status_code == 403  # buyer has no inventory:write
    ok = client.post(f"{B}/inventory/{low['items'][0]['id']}/adjust", json={"quantity": 5, "reason": "cycle count"}, headers=auth("manager"))
    assert ok.status_code == 200 and ok.json()["quantity_on_hand"] == low["items"][0]["quantity_on_hand"] + 5


def test_calc_totals():
    sub, tax, tot = calc_totals([(10, Decimal("2.50")), (3, Decimal("10.00"))])
    assert (sub, tax, tot) == (Decimal("55.00"), Decimal("5.50"), Decimal("60.50"))


def _supplier_with_product(tx_db):
    from app.models import SupplierProduct, Warehouse
    sp = tx_db.scalars(select(SupplierProduct).limit(1)).first()
    return sp, tx_db.scalar(select(Warehouse).limit(1))


def test_po_create_totals_and_status_flow(client, auth, tx_db):
    sp, wh = _supplier_with_product(tx_db)
    body = {"supplier_id": str(sp.supplier_id), "warehouse_id": str(wh.id), "lines": [{"product_id": str(sp.product_id), "quantity": 10}]}
    r = client.post(f"{B}/purchase-orders", json=body, headers=auth("buyer"))
    assert r.status_code == 201, r.text
    po = r.json()
    assert Decimal(po["subtotal"]) == Decimal(sp.unit_price) * 10 and po["status"] == "draft"
    h = auth("buyer")
    pid = po["id"]
    assert client.post(f"{B}/purchase-orders/{pid}/status", json={"to_status": "received"}, headers=h).status_code == 409  # invalid jump
    assert client.post(f"{B}/purchase-orders/{pid}/status", json={"to_status": "pending_approval"}, headers=h).status_code == 200
    assert client.post(f"{B}/purchase-orders/{pid}/status", json={"to_status": "approved"}, headers=h).status_code == 403  # sensitive
    ok = client.post(f"{B}/purchase-orders/{pid}/status", json={"to_status": "approved"}, headers=auth("manager"))
    assert ok.status_code == 200 and [x["to_status"] for x in ok.json()["history"]] == ["draft", "pending_approval", "approved"]


def test_po_rejects_product_not_offered_by_supplier(client, auth, tx_db):
    from app.models import SupplierProduct, Warehouse
    sp = tx_db.scalars(select(SupplierProduct).limit(1)).first()
    other = tx_db.scalar(select(Product.id).where(~Product.id.in_(select(SupplierProduct.product_id).where(SupplierProduct.supplier_id == sp.supplier_id))).limit(1))
    wh = tx_db.scalar(select(Warehouse).limit(1))
    r = client.post(f"{B}/purchase-orders", json={"supplier_id": str(sp.supplier_id), "warehouse_id": str(wh.id), "lines": [{"product_id": str(other), "quantity": 1}]}, headers=auth("buyer"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_lines"


def test_request_workflow_end_to_end(client, auth, tx_db):
    from app.models import SupplierProduct
    sp = tx_db.scalars(select(SupplierProduct).limit(1)).first()
    body = {"justification": "Low stock", "priority": "high", "lines": [{"product_id": str(sp.product_id), "quantity": 25, "suggested_supplier_id": str(sp.supplier_id)}]}
    buyer, mgr = auth("buyer"), auth("manager")
    r = client.post(f"{B}/purchase-requests", json=body, headers=buyer).json()
    rid = r["id"]
    assert r["status"] == "draft" and r["request_number"].startswith("REQ-")
    assert client.post(f"{B}/purchase-requests/{rid}/approve", json={}, headers=mgr).status_code == 409  # draft can't be approved
    assert client.post(f"{B}/purchase-requests/{rid}/submit", headers=buyer).json()["status"] == "pending_approval"
    assert client.post(f"{B}/purchase-requests/{rid}/approve", json={}, headers=buyer).status_code == 403
    assert client.post(f"{B}/purchase-requests/{rid}/convert", headers=mgr).status_code == 409  # not approved yet
    assert client.post(f"{B}/purchase-requests/{rid}/approve", json={"comment": "ok"}, headers=mgr).json()["status"] == "approved"
    po = client.post(f"{B}/purchase-requests/{rid}/convert", headers=buyer)
    assert po.status_code == 200 and po.json()["status"] == "draft"
    final = client.get(f"{B}/purchase-requests/{rid}", headers=buyer).json()
    assert final["status"] == "converted"
    actions = [a["action"] for a in client.get(f"{B}/purchase-requests/{rid}/approvals", headers=buyer).json()]
    assert actions == ["submitted", "pending_approval", "approved", "converted"]


def test_dashboard_matches_database(client, auth, db):
    d = client.get(f"{B}/dashboard/overview", headers=auth("viewer")).json()
    assert d["total_products"] == db.scalar(select(func.count()).select_from(Product))
    assert d["total_suppliers"] == db.scalar(select(func.count()).select_from(Supplier))
    assert d["is_demo_data"] is True
    low = db.scalar(select(func.count()).select_from(Inventory).where(Inventory.quantity_on_hand - Inventory.quantity_reserved <= Inventory.reorder_level))
    assert d["low_stock_records"] == low
    assert sum(d["po_status_breakdown"].values()) == db.scalar(select(func.count()).select_from(PurchaseOrder))


def test_audit_log_written(client, auth, tx_db):
    from app.models import AuditLog
    client.post(f"{B}/auth/login", json={"email": "admin@procurax.demo", "password": "nope"})
    assert tx_db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "login_failed")) >= 1


def test_health(client):
    h = client.get("/health").json()
    assert h["database"] == "ok" and h["pgvector"] is True


def test_names_embedded_and_new_filters(client, auth):
    h = auth("viewer")
    po = client.get(f"{B}/purchase-orders?page_size=1", headers=h).json()["items"][0]
    assert po["supplier_name"] and po["warehouse_name"]
    d = client.get(f"{B}/purchase-orders/{po['id']}", headers=h).json()
    assert all(l["product_name"] and l["product_sku"] for l in d["lines"])
    rq = client.get(f"{B}/purchase-requests?q=REQ-0000&sort=priority&order=asc", headers=h).json()
    assert rq["items"] and all(l["product_name"] for r in rq["items"] for l in r["lines"])
    inv = client.get(f"{B}/inventory?sort=on_hand&order=desc&page_size=5", headers=h).json()["items"]
    assert [i["quantity_on_hand"] for i in inv] == sorted([i["quantity_on_hand"] for i in inv], reverse=True)
    assert "Germany" in client.get(f"{B}/suppliers-meta/countries", headers=h).json()
    assert client.get(f"{B}/inventory/reorder-recommendations", headers=h).json()[0]["warehouse_id"]
    done = client.get(f"{B}/purchase-requests?status=approved&page_size=1", headers=h).json()["items"][0]["id"]
    assert all("actor_name" in a for a in client.get(f"{B}/purchase-requests/{done}/approvals", headers=h).json())


def test_production_config_guard():
    import pytest
    from app.core.config import Settings, assert_production_safe
    ok = dict(environment="production", jwt_secret="x" * 20 + "Zq9" * 5, database_url="postgresql+psycopg://u:Str0ngRandom@postgres/db", cors_origins="https://app.example.com")
    assert_production_safe(Settings(**ok))
    for bad in ({"jwt_secret": "dev-only-secret-not-for-production-0123456789"}, {"jwt_secret": "short"}, {"database_url": "postgresql+psycopg://u:devpassword@h/db"},
                {"cors_origins": "http://localhost:5173"}):
        with pytest.raises(RuntimeError, match="Unsafe production"):
            assert_production_safe(Settings(**{**ok, **bad}))
    assert_production_safe(Settings(environment="development"))  # dev is never blocked
