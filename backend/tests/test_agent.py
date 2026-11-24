import json
import pytest
from sqlalchemy import func, select
from app.chatbot.generative import provider as prov
from app.chatbot.generative.provider import LLMProvider, LLMResponse
from app.models import AgentDefinition, AgentExecutionStep, PurchaseRequest, User
from app.tools import registry as T

B = "/api/v1"


class Scripted(LLMProvider):
    """Test double driving the agent loop. fn(messages) -> dict|str. Lives in tests only."""
    name = "scripted"

    def __init__(self, fn):
        self.fn, self.n = fn, 0

    def complete(self, system, messages, max_tokens=1024, temperature=0.2):
        self.n += 1
        if "produce ONLY a plan" in system:
            return LLMResponse(json.dumps({"plan": ["find at-risk stock", "size reorders", "prepare request"]}), "scripted")
        out = self.fn(messages)
        return LLMResponse(out if isinstance(out, str) else json.dumps(out), "scripted")


def observations(messages):
    return [json.loads(m["content"][len("OBSERVATION: "):]) for m in messages if m["content"].startswith("OBSERVATION: ")]


def replenishment_agent(messages):
    obs = observations(messages)
    if len(obs) == 0:
        return {"thought": "find risky stock", "action": {"tool": "get_low_stock_items", "args": {"within_days": 7, "limit": 2}}}
    if len(obs) == 1:
        item = obs[0]["items"][0]
        return {"action": {"tool": "calculate_reorder_quantity", "args": {"product_id": item["product_id"]}}}
    if len(obs) == 2:
        item = obs[0]["items"][0]
        return {"action": {"tool": "create_purchase_request", "args": {"justification": "Predicted stockout within 7 days", "priority": "high",
                "lines": [{"product_id": item["product_id"], "quantity": max(1, obs[1]["total_suggested_quantity"]), "supplier_id": obs[1]["supplier_id"]}]}}}
    if len(obs) == 3:
        return {"final": f"Prepared draft request {obs[2]['request_number']} for approval workflow."}
    return {"final": "done"}


@pytest.fixture()
def use():
    def _set(fn):
        p = Scripted(fn); prov.set_provider_override(p); return p
    yield _set
    prov.set_provider_override(None)


def count_requests(db):
    return db.scalar(select(func.count()).select_from(PurchaseRequest))


def test_full_flow_pauses_for_approval_then_executes(client, auth, tx_db, use):
    use(replenishment_agent)
    before = count_requests(tx_db)
    ex = client.post(f"{B}/agent/executions", json={"request": "Find products that may run out within the next seven days and prepare purchase requests."}, headers=auth("buyer")).json()
    assert ex["status"] == "awaiting_approval" and len(ex["plan"]) == 3
    assert [s["tool"] for s in ex["steps"]] == ["get_low_stock_items", "calculate_reorder_quantity", "create_purchase_request"]
    assert [s["status"] for s in ex["steps"]] == ["ok", "ok", "awaiting_approval"]
    assert count_requests(tx_db) == before                      # NOTHING committed before human approval
    ap = ex["approvals"][0]; assert ap["status"] == "pending"
    # a buyer cannot approve; viewer cannot even run
    assert client.post(f"{B}/agent/approvals/{ap['id']}/decision", json={"approve": True}, headers=auth("buyer")).status_code == 403
    assert client.post(f"{B}/agent/executions", json={"request": "hello agent"}, headers=auth("viewer")).status_code == 403
    done = client.post(f"{B}/agent/approvals/{ap['id']}/decision", json={"approve": True, "comment": "ok"}, headers=auth("manager")).json()
    assert done["status"] == "completed" and "Prepared draft request" in done["final_result"]
    assert count_requests(tx_db) == before + 1
    req = tx_db.scalar(select(PurchaseRequest).order_by(PurchaseRequest.created_at.desc()))
    assert req.status == "draft" and str(req.created_by_agent_execution_id) == ex["id"] and req.requested_by == tx_db.scalar(select(User.id).where(User.email == "buyer@procurax.demo"))
    assert any("Approved by" in l["message"] for l in done["logs"])
    # cannot decide twice
    assert client.post(f"{B}/agent/approvals/{ap['id']}/decision", json={"approve": True}, headers=auth("manager")).status_code == 409
    # history persisted
    assert ex["id"] in [e["id"] for e in client.get(f"{B}/agent/executions", headers=auth("buyer")).json()]


def test_rejection_changes_nothing(client, auth, tx_db, use):
    use(replenishment_agent)
    before = count_requests(tx_db)
    ex = client.post(f"{B}/agent/executions", json={"request": "prepare purchase requests for low stock"}, headers=auth("buyer")).json()
    r = client.post(f"{B}/agent/approvals/{ex['approvals'][0]['id']}/decision", json={"approve": False, "comment": "no budget"}, headers=auth("manager")).json()
    assert r["status"] == "rejected" and "nothing was changed" in r["final_result"] and count_requests(tx_db) == before
    assert r["steps"][-1]["status"] == "skipped"


def test_max_iterations_enforced(client, auth, use):
    p = use(lambda m: {"action": {"tool": "search_products", "args": {"query": "bolt"}}})
    ex = client.post(f"{B}/agent/executions", json={"request": "loop forever please"}, headers=auth("buyer")).json()
    assert ex["status"] == "failed" and "maximum of 10 tool iterations" in ex["error"] and len(ex["steps"]) == 10


def test_timeout_enforced(client, auth, tx_db, use):
    use(lambda m: {"action": {"tool": "search_products", "args": {"query": "bolt"}}})
    tx_db.scalar(select(AgentDefinition)).timeout_seconds = -1; tx_db.flush()
    ex = client.post(f"{B}/agent/executions", json={"request": "this will time out"}, headers=auth("buyer")).json()
    assert ex["status"] == "timed_out" and "timeout" in ex["error"]


def test_bad_tool_calls_are_rejected_and_stop_after_repeats(client, auth, use):
    use(lambda m: {"action": {"tool": "run_sql", "args": {"sql": "DROP TABLE products"}}})
    ex = client.post(f"{B}/agent/executions", json={"request": "try to run sql"}, headers=auth("buyer")).json()
    assert ex["status"] == "failed" and all(s["status"] == "error" and "Unknown tool" in s["error"] for s in ex["steps"]) and len(ex["steps"]) == 3


def test_invalid_args_then_recovery(client, auth, use):
    def fn(messages):
        obs = observations(messages)
        if not obs: return {"action": {"tool": "search_products", "args": {"query": "", "limit": 500}}}  # invalid
        if len(obs) == 1: return {"action": {"tool": "search_products", "args": {"query": "bolt", "limit": 3}}}
        return {"final": f"found {len(obs[1]['products'])}"}
    ex = client.post(f"{B}/agent/executions", json={"request": "find bolts"}, headers=auth("viewer") if False else auth("buyer")).json() if use(fn) else None
    assert ex["status"] == "completed" and ex["steps"][0]["status"] == "error" and "Invalid arguments" in ex["steps"][0]["error"] and ex["steps"][1]["status"] == "ok"


def test_malformed_model_output_handled(client, auth, use):
    use(lambda m: "I think we should buy more bolts")
    ex = client.post(f"{B}/agent/executions", json={"request": "do something"}, headers=auth("buyer")).json()
    assert ex["status"] == "failed" and "unusable model responses" in ex["error"]


def test_tool_permissions_checked_against_user(tx_db):
    viewer = tx_db.scalar(select(User).where(User.email == "viewer@procurax.demo"))
    with pytest.raises(T.ToolError, match="lacks permission"):
        T.validate_call(tx_db, viewer, "create_purchase_request", {})
    buyer = tx_db.scalar(select(User).where(User.email == "buyer@procurax.demo"))
    with pytest.raises(T.ToolError, match="Invalid arguments"):
        T.validate_call(tx_db, buyer, "create_purchase_request", {"justification": "x", "lines": []})


def test_registry_is_closed_and_has_no_dangerous_tools():
    names = set(T.REGISTRY)
    assert {"search_products", "get_inventory", "get_low_stock_items", "search_suppliers", "get_supplier_products", "get_supplier_lead_times",
            "calculate_reorder_quantity", "create_purchase_request", "get_purchase_order_status", "compare_supplier_prices"} <= names
    assert not any(k in n for n in names for k in ("sql", "shell", "exec", "approve", "delete"))
    assert {t.name for t in T.TOOLS if t.sensitive} == {"create_purchase_request", "submit_purchase_request"}


def test_tool_rejects_supplier_not_offering_product(tx_db):
    buyer = tx_db.scalar(select(User).where(User.email == "buyer@procurax.demo"))
    from app.models import SupplierProduct, Product
    sp = tx_db.scalars(select(SupplierProduct)).first()
    other = tx_db.scalar(select(Product.id).where(~Product.id.in_(select(SupplierProduct.product_id).where(SupplierProduct.supplier_id == sp.supplier_id))).limit(1))
    tool, args = T.validate_call(tx_db, buyer, "create_purchase_request", {"justification": "bad pairing here", "lines": [{"product_id": str(other), "quantity": 5, "supplier_id": str(sp.supplier_id)}]})
    with pytest.raises(T.ToolError, match="does not offer"):
        T.execute(tx_db, buyer, tool, args)


def test_no_provider_configured_fails_explicitly(client, auth):
    prov.set_provider_override(None)
    ex = client.post(f"{B}/agent/executions", json={"request": "find low stock"}, headers=auth("buyer")).json()
    assert ex["status"] == "failed" and "No LLM provider is configured" in ex["error"] and ex["steps"] == []


def test_agentic_via_chat_reports_action_not_executed_until_approved(client, auth, use):
    use(replenishment_agent)
    r = client.post(f"{B}/chatbots/agentic/chat", json={"message": "prepare reorder requests for items running out within 7 days"}, headers=auth("buyer")).json()
    assert r["metadata"]["action_executed"] is False and r["metadata"]["extra"]["execution_status"] == "awaiting_approval" and r["metadata"]["extra"]["approval_id"]


def test_real_tools_return_database_content(tx_db):
    buyer = tx_db.scalar(select(User).where(User.email == "buyer@procurax.demo"))
    tool, args = T.validate_call(tx_db, buyer, "get_low_stock_items", {"within_days": 7, "limit": 5})
    out = T.execute(tx_db, buyer, tool, args)
    assert out["items"] and all(i["days_of_cover"] <= 7 for i in out["items"])
    tool, args = T.validate_call(tx_db, buyer, "compare_supplier_prices", {"product_id": out["items"][0]["product_id"]})
    offers = T.execute(tx_db, buyer, tool, args)["offers_cheapest_first"]
    prices = [float(o["unit_price"]) for o in offers]
    assert prices == sorted(prices) and len(offers) >= 2


def test_reorder_tool_batches_products(tx_db):
    buyer = tx_db.scalar(select(User).where(User.email == "buyer@procurax.demo"))
    tool, args = T.validate_call(tx_db, buyer, "get_low_stock_items", {"within_days": 7, "limit": 3})
    ids = [i["product_id"] for i in T.execute(tx_db, buyer, tool, args)["items"]]
    tool, args = T.validate_call(tx_db, buyer, "calculate_reorder_quantity", {"product_ids": ids})
    out = T.execute(tx_db, buyer, tool, args)
    assert [r["product_id"] for r in out["results"]] == ids and all("total_suggested_quantity" in r for r in out["results"])


def test_backoff_respects_deadline(monkeypatch):
    import time, httpx
    from app.chatbot.generative.provider import GroqProvider, ProviderError, deadline_var
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(429, text="try again in 25s", json={"error": {"message": "x"}}))
    slept = []
    monkeypatch.setattr(time, "sleep", lambda s: slept.append(s))
    deadline_var.set(time.time() + 5)
    with pytest.raises(ProviderError, match="deadline"):
        GroqProvider("k", "m").complete("s", [])
    assert slept == []
    deadline_var.set(None)
