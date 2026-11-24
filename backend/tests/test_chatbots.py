import pytest
from sqlalchemy import select, func
from app.chatbot.nlp import engine as nlp
from app.chatbot.nlp.classifier import TfidfIntentClassifier
from app.chatbot.nlp.preprocess import normalise
from app.chatbot.rule_based import engine as rules
from app.ml import predict as P
from app.models import ChatbotMessage, ChatbotConfiguration, SupplierProduct

B = "/api/v1"


# ---- rule based
def test_rule_threshold_from_database(tx_db):
    r = rules.answer(tx_db, "What is the purchase approval threshold?")
    assert "$5000" in r.reply and "chatbot_configurations" in r.data_sources
    cfg = tx_db.scalar(select(ChatbotConfiguration).where(ChatbotConfiguration.key == "approval_threshold"))
    cfg.value = {"value": "7500"}; tx_db.flush()
    assert "$7500" in rules.answer(tx_db, "what is the approval limit").reply  # DB-driven, not hard-coded


def test_rule_moq_matches_db(tx_db):
    mn = tx_db.scalar(select(func.min(SupplierProduct.min_order_qty)))
    assert f"{mn} units" in rules.answer(tx_db, "What is the minimum reorder quantity?").reply


def test_rule_hours_and_unknown(tx_db):
    assert "08:00" in rules.answer(tx_db, "What are the procurement working hours?").reply
    r = rules.answer(tx_db, "what is the weather")
    assert "don't have a rule" in r.reply and r.confidence is None  # no invented confidence


def test_rule_deterministic(tx_db):
    assert rules.answer(tx_db, "payment terms?").reply == rules.answer(tx_db, "payment terms?").reply


# ---- NLP
@pytest.mark.parametrize("msg", ["Which POs are still pending?", "List orders awaiting approval.", "show orders waiting for sign off"])
def test_nlp_pending_intent(tx_db, msg):
    clf, _ = nlp.get_classifier(tx_db)
    p = clf.predict(msg)
    assert p.intent == "list_pending_pos" and p.score >= 0.3


def test_nlp_open_orders_intent_and_data(tx_db):
    r = nlp.answer(tx_db, "Show me my open purchase orders.")
    assert r.table and r.table["columns"][0] == "PO" and r.confidence > 0.3
    assert all(row[2] in ("pending_approval", "approved", "sent", "partially_received") for row in r.table["rows"])


def test_nlp_unknown_below_threshold(tx_db):
    r = nlp.answer(tx_db, "tell me a joke about penguins")
    assert "couldn't confidently" in r.reply and r.table is None and not r.action_executed


def test_nlp_entity_extraction(tx_db):
    from app.chatbot.nlp.entities import extract
    e = extract(tx_db, "details for FAS-0001 and PO-2025010 that are approved")
    assert e["sku"] == "FAS-0001" and e["po_number"] == "PO-2025010" and e["status"] == "approved"


def test_nlp_classifier_replaceable(tx_db):
    class Always:
        def predict(self, t):
            from app.chatbot.nlp.classifier import IntentPrediction
            return IntentPrediction("list_low_stock", 0.99, [("list_low_stock", 0.99)])
    r = nlp.answer(tx_db, "anything", classifier=Always())
    assert "at or below reorder level" in r.reply


def test_normalise_synonyms():
    assert normalise("Show me my POs!") == normalise("show purchase orders")


# ---- ML (uses the models trained in the dev DB)
def test_ml_models_registered_with_real_metrics(client, auth):
    ms = client.get(f"{B}/ml/models", headers=auth("viewer")).json()
    names = {m["name"] for m in ms if m["is_active"]}
    assert names == {"message_classifier", "demand_forecaster", "stockout_risk"}
    risk = next(m for m in ms if m["name"] == "stockout_risk" and m["is_active"])
    assert 0 < risk["metrics"]["roc_auc"] <= 1 and "baseline_naive_cover_rule" in risk["metrics"] and risk["metrics"]["caveats"]
    assert risk["metrics"]["training_stock_source"].startswith("SIMULATED")


def test_ml_classify(tx_db):
    out = P.classify_message(tx_db, "The shipment arrived 10 days late and nothing was delivered on the agreed date")
    assert out["label"] == "delivery_issue" and 0 < out["confidence"] <= 1
    assert abs(sum(out["probabilities"].values()) - 1) < 0.01
    assert P.classify_message(tx_db, "Invoice does not match the purchase order amount")["label"] == "invoice_issue"


def test_ml_stockout_scan(tx_db):
    r = P.stockout_scan(tx_db, limit=5)
    assert r["scanned"] == 1000 and r["flagged"] > 0 and len(r["items"]) <= 5
    assert all(0.5 <= i["risk_probability"] <= 1 and i["suggested_replenishment"] >= 0 for i in r["items"])
    risks = [i["risk_probability"] for i in r["items"]]
    assert risks == sorted(risks, reverse=True)


def test_ml_train_requires_permission(client, auth):
    assert client.post(f"{B}/ml/train", headers=auth("buyer")).status_code == 403


# ---- chat API + persistence
def test_chat_persists_history_and_metadata(client, auth, tx_db):
    h = auth("buyer")
    r = client.post(f"{B}/chatbots/rule_based/chat", json={"message": "What are the procurement working hours?"}, headers=h).json()
    assert "Monday" in r["reply"] and r["metadata"]["action_executed"] is False
    sid = r["session_id"]
    r2 = client.post(f"{B}/chatbots/rule_based/chat", json={"message": "payment terms", "session_id": sid}, headers=h).json()
    assert r2["session_id"] == sid
    msgs = client.get(f"{B}/chat-sessions/{sid}/messages", headers=h).json()
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert client.get(f"{B}/chat-sessions/{sid}/messages", headers=auth("viewer")).status_code == 404  # other user's session
    assert len(client.get(f"{B}/chatbots/rule_based/sessions", headers=h).json()) >= 1


def test_catalogue_and_unimplemented_bots_are_honest(client, auth):
    cat = client.get(f"{B}/chatbots", headers=auth("viewer")).json()
    assert [c["slug"] for c in cat] == ["rule_based", "nlp", "ml", "generative", "rag", "agentic"]
    assert {c["slug"]: c["available"] for c in cat} == {"rule_based": True, "nlp": True, "ml": True, "generative": True, "rag": True, "agentic": True}
    r = client.post(f"{B}/chatbots/nonexistent/chat", json={"message": "hi"}, headers=auth("viewer"))
    assert r.status_code in (404, 501)


# ---- regression: everyday phrasings (found failing in manual testing)
@pytest.mark.parametrize("msg,expect", [
    ("details of PO-2025074", "PO-2025074:"), ("status of PO-2025010", "PO-2025010:"), ("show purchase order PO-2025001", "PO-2025001:"),
    ("what is the status of PO-2025100", "PO-2025100:"), ("details of REQ-00012", "REQ-00012:"), ("show request REQ-00003", "REQ-00003:"),
    ("find product FAS-0001", "FAS-0001:"), ("how many purchase orders do we have", "150 purchase orders"),
    ("what should I reorder", "need reordering"), ("list all suppliers", "supplier(s)"), ("list suppliers in Germany", "in Germany"),
    ("orders from supplier SUP-005", "supplier Northgate"), ("who is Apex", "SUP-001"), ("hello", "Hello"), ("help", "Try:"),
    ("what can you do", "Try:"), ("thanks", "welcome"), ("where is my order", "open orders"),
])
def test_nlp_everyday_phrasings(tx_db, msg, expect):
    r = nlp.answer(tx_db, msg)
    assert expect in r.reply, (msg, r.reply)


@pytest.mark.parametrize("msg,status", [("show cancelled orders", "cancelled"), ("show approved purchase orders", "approved")])
def test_nlp_status_lists_are_lists_not_lookups(tx_db, msg, status):
    r = nlp.answer(tx_db, msg)
    assert r.table and all(row[2] == status for row in r.table["rows"]) and "Which purchase order" not in r.reply


def test_nlp_entity_routing_reports_no_fake_confidence(tx_db):
    r = nlp.answer(tx_db, "details of PO-2025074")
    assert r.confidence is None and "Entity-first routing" in r.approach and r.table["columns"][0] == "SKU"


def test_nlp_unknown_ids_are_handled(tx_db):
    assert "couldn't find purchase order PO-9999999" in nlp.answer(tx_db, "details of PO-9999999").reply
    assert "couldn't find purchase request REQ-99999" in nlp.answer(tx_db, "details of REQ-99999").reply


@pytest.mark.parametrize("msg,expect", [("who approves purchases", "Procurement Manager"), ("how does approval work", "Draft"), ("help", "rule-based"),
                                        ("hi", "Hello"), ("hello what are the working hours", "Monday")])
def test_rule_everyday_phrasings(tx_db, msg, expect):
    assert expect in rules.answer(tx_db, msg).reply
