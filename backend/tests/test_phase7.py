import json
import pytest
from sqlalchemy import select
from app.chatbot.generative import provider as prov
from app.models import AuditLog, ChatbotConfiguration, RuleDefinition
from tests.test_rag_generative import FakeProvider

B = "/api/v1"


# ---- comparison
def test_compare_one_each_deterministic_bot_same_question(client, auth):
    h = auth("buyer"); q = {"message": "Which products need to be reordered?"}
    res = {s: client.post(f"{B}/compare/{s}", json=q, headers=h).json() for s in ("rule_based", "nlp", "ml")}
    assert all(r["status"] == "ok" and r["duration_ms"] >= 0 for r in res.values())
    assert res["nlp"]["confidence"] is not None and res["nlp"]["confidence_kind"]
    assert "confidence" not in res["rule_based"]                    # rule engine produces no confidence: none invented
    assert res["ml"]["table"]["rows"] and res["ml"]["action_executed"] is False


def test_compare_is_stateless_for_non_agent_bots(client, auth, db):
    from sqlalchemy import func
    from app.models import ChatbotSession
    before = db.scalar(select(func.count()).select_from(ChatbotSession))
    client.post(f"{B}/compare/rule_based", json={"message": "payment terms"}, headers=auth("buyer"))
    assert db.scalar(select(func.count()).select_from(ChatbotSession)) == before


def test_compare_llm_bots_report_not_configured_honestly(client, auth):
    r = client.post(f"{B}/compare/generative", json={"message": "hi there"}, headers=auth("buyer")).json()
    assert r["status"] == "not_configured" and "No LLM provider" in r["reply"]


def test_compare_with_llm_and_rag_and_agent(client, auth):
    prov.set_provider_override(FakeProvider("The threshold is $5000 [1]."))
    try:
        h = auth("buyer")
        rag = client.post(f"{B}/compare/rag", json={"message": "What is the approval threshold for purchases?"}, headers=h).json()
        assert rag["status"] == "ok" and rag["retrieval"] and "confidence" not in rag
        assert client.post(f"{B}/compare/generative", json={"message": "Summarise stock"}, headers=h).json()["status"] == "ok"
        ag = client.post(f"{B}/compare/agentic", json={"message": "anything"}, headers=h).json()
        assert ag["status"] in ("ok", "provider_error") and ag["action_executed"] is False
    finally:
        prov.set_provider_override(None)


def test_compare_viewer_cannot_run_agent_and_unknown_bot(client, auth):
    assert client.post(f"{B}/compare/agentic", json={"message": "x"}, headers=auth("viewer")).json()["status"] == "forbidden"
    assert client.post(f"{B}/compare/nope", json={"message": "x"}, headers=auth("viewer")).status_code == 404


# ---- insights / analytics
def test_insights_computed_from_database(client, auth):
    d = client.get(f"{B}/dashboard/insights", headers=auth("viewer")).json()
    assert d["generated_from"].startswith("database") and d["items"] and d["narrative"] is None
    assert {"severity", "title", "detail", "source"} <= set(d["items"][0])
    sev = [i["severity"] for i in d["items"]]
    assert sev == sorted(sev, key=["high", "medium", "low"].index)


def test_insight_narrative_requires_provider(client, auth):
    n = client.get(f"{B}/dashboard/insights?narrative=true", headers=auth("viewer")).json()["narrative"]
    assert n["text"] is None and "No LLM provider" in n["reason"]
    prov.set_provider_override(FakeProvider("Act on low stock first."))
    try:
        assert client.get(f"{B}/dashboard/insights?narrative=true", headers=auth("viewer")).json()["narrative"]["text"] == "Act on low stock first."
    finally:
        prov.set_provider_override(None)


def test_ai_analytics_shapes(client, auth):
    a = client.get(f"{B}/analytics/ai", headers=auth("viewer")).json()
    assert {x["slug"] for x in a["messages_by_bot"]} == {"rule_based", "nlp", "ml", "generative", "rag", "agentic"}
    assert any(m["name"] == "stockout_risk" for m in a["ml_predictions_by_model"]) and a["documents_by_status"]


# ---- admin
def test_admin_requires_admin_role(client, auth):
    for role in ("manager", "buyer", "viewer"):
        assert client.get(f"{B}/admin/providers", headers=auth(role)).status_code == 403
    assert client.get(f"{B}/admin/providers", headers=auth("admin")).status_code == 200


def test_provider_admin_never_exposes_keys_and_validates_default(client, auth):
    h = auth("admin")
    r = client.get(f"{B}/admin/providers", headers=h)
    assert all(set(p) == {"provider", "model", "is_default", "api_key_env_var", "key_configured"} for p in r.json())  # env var NAME only, never a secret
    assert not any(isinstance(v, str) and (v.startswith("gsk_") or v.startswith("sk-")) for p in r.json() for v in p.values())
    assert {p["provider"] for p in r.json()} == {"anthropic", "groq"}
    # keys are blanked by the autouse test fixture, so promoting a provider must be refused
    assert client.patch(f"{B}/admin/providers/groq", json={"is_default": True}, headers=h).status_code == 409
    assert client.patch(f"{B}/admin/providers/groq", json={"model": "some/model"}, headers=h).json()["model"] == "some/model"


def test_policy_change_flows_into_rule_bot(client, auth):
    h = auth("admin")
    assert client.patch(f"{B}/admin/policy/approval_threshold", json={"value": "abc"}, headers=h).status_code == 422
    assert client.patch(f"{B}/admin/policy/approval_threshold", json={"value": "9000"}, headers=h).status_code == 200
    r = client.post(f"{B}/chatbots/rule_based/chat", json={"message": "what is the approval threshold"}, headers=h).json()
    assert "$9000" in r["reply"]


def test_rule_edit_validates_template_and_tool_toggle_blocks_agent(client, auth, tx_db):
    h = auth("admin")
    assert client.patch(f"{B}/admin/rules/working_hours", json={"response_template": "Open {nonexistent}"}, headers=h).status_code == 422
    assert client.patch(f"{B}/admin/rules/working_hours", json={"response_template": "Hours: {working_hours}."}, headers=h).status_code == 200
    assert client.patch(f"{B}/admin/tools/search_products", json={"is_enabled": False}, headers=h).status_code == 200
    from app.tools import registry as T
    from app.models import User
    buyer = tx_db.scalar(select(User).where(User.email == "buyer@procurax.demo"))
    with pytest.raises(T.ToolError, match="disabled"):
        T.validate_call(tx_db, buyer, "search_products", {"query": "x"})


def test_agent_limits_and_audit_trail(client, auth):
    h = auth("admin")
    assert client.patch(f"{B}/admin/agent", json={"max_iterations": 0}, headers=h).status_code == 422
    assert client.patch(f"{B}/admin/agent", json={"max_iterations": 4}, headers=h).json()["max_iterations"] == 4
    log = client.get(f"{B}/admin/audit?action=admin.agent", headers=h).json()
    assert log["total"] >= 1 and log["items"][0]["user"] == "admin@procurax.demo"


def test_prompt_edit(client, auth):
    h = auth("admin")
    assert client.patch(f"{B}/admin/prompts/rag_system", json={"template": "short"}, headers=h).status_code == 422
    assert client.patch(f"{B}/admin/prompts/rag_system", json={"template": "Answer only from the numbered context. Cite [n]."}, headers=h).status_code == 200
