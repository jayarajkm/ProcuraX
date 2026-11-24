import pytest
from sqlalchemy import select
from app.chatbot import i18n
from app.chatbot.generative import provider as prov
from app.chatbot.generative.provider import LLMProvider, LLMResponse
from app.services import chat as chat_svc

B = "/api/v1"


class Translator(LLMProvider):
    """Test double: acts as translator (system prompt mentions 'translator') or as the answering LLM. Records every call."""
    name = "fake"

    def __init__(self, to_english="show open purchase orders", from_english=lambda t, lang: f"[{lang}] {t}", answer="Respuesta [1]"):
        self.calls, self.to_english, self.from_english, self.answer = [], to_english, from_english, answer

    def complete(self, system, messages, max_tokens=1024, temperature=0.2):
        self.calls.append((system, messages))
        if "professional translator" in system:
            target = system.split("into ")[1].split(".")[0]
            text = messages[0]["content"]
            return LLMResponse(self.to_english if target == "English" else self.from_english(text, target), "fake")
        return LLMResponse(self.answer, "fake")


@pytest.fixture()
def use():
    def _set(p):
        prov.set_provider_override(p); return p
    yield _set
    prov.set_provider_override(None)


def test_language_list_and_validation(client, auth):
    langs = client.get(f"{B}/languages", headers=auth("viewer")).json()
    assert langs[0]["code"] == "en" and any(l["code"] == "ar" and l["rtl"] for l in langs) and len(langs) >= 10
    r = client.post(f"{B}/chatbots/rule_based/chat", json={"message": "hi", "language": "xx"}, headers=auth("viewer"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_language"


def test_english_makes_no_llm_calls_for_deterministic_bots(client, auth, use):
    p = use(Translator())
    for slug in ("rule_based", "nlp", "ml"):
        client.post(f"{B}/chatbots/{slug}/chat", json={"message": "show open purchase orders"}, headers=auth("viewer"))
    assert p.calls == []                       # deterministic bots stay LLM-free unless a language is selected


@pytest.mark.parametrize("slug,msg", [("rule_based", "payment terms"), ("nlp", "show open purchase orders"), ("ml", "classify: shipment arrived late")])
def test_deterministic_bots_translate_in_and_out_and_disclose(client, auth, use, slug, msg):
    p = use(Translator(to_english=msg))
    r = client.post(f"{B}/chatbots/{slug}/chat", json={"message": "mensaje en otro idioma", "language": "es"}, headers=auth("viewer")).json()
    m = r["metadata"]
    assert r["reply"].startswith("[Spanish]") and m["language"] == "es"
    t = m["translation"]
    assert t["mode"] == "deterministic_bot_with_llm_translation" and t["input_translated_to_english"] == msg
    assert t["original_reply"] and not t["original_reply"].startswith("[Spanish]") and "table" in t["not_translated"]
    assert len(p.calls) == 2                   # exactly: question->English, reply->language


def test_translation_unavailable_degrades_to_english_with_notice(client, auth):
    prov.set_provider_override(None)           # autouse fixture blanks the keys: no provider
    r = client.post(f"{B}/chatbots/rule_based/chat", json={"message": "What are the working hours", "language": "hi"}, headers=auth("viewer")).json()
    assert "Monday" in r["reply"] and "Translation to Hindi unavailable" in r["reply"]
    assert "input_translation_error" in r["metadata"]["translation"] and "output_translation_error" in r["metadata"]["translation"]


def test_generative_gets_language_instruction_and_english_fact_selection(client, auth, use):
    p = use(Translator(to_english="which products are low on stock", answer="Les produits ..."))
    r = client.post(f"{B}/chatbots/generative/chat", json={"message": "quels produits sont en rupture ?", "language": "fr"}, headers=auth("viewer")).json()
    system, msgs = p.calls[-1]
    assert "Write your entire answer in French" in system and "Low-stock records" in system   # facts chosen from the English translation
    assert msgs[-1]["content"] == "quels produits sont en rupture ?" and r["reply"] == "Les produits ..."
    assert r["metadata"]["translation"]["mode"] == "llm_native"


def test_rag_retrieves_with_english_query_and_answers_in_language(client, auth, use):
    p = use(Translator(to_english="What is the approval threshold for purchases?", answer="Der Schwellenwert beträgt 5000 [1]."))
    r = client.post(f"{B}/chatbots/rag/chat", json={"message": "Was ist die Genehmigungsgrenze für Einkäufe?", "language": "de"}, headers=auth("viewer")).json()
    system = p.calls[-1][0]
    assert "Write your entire answer in German" in system and "Purchase Approval Policy" in system
    assert r["reply"].startswith("Der Schwellenwert") and r["metadata"]["retrieval"][0]["document"] == "Purchase Approval Policy"


def test_rag_no_info_message_is_localised(client, auth, use):
    use(Translator(to_english="recipe for chocolate cake", from_english=lambda t, lang: f"<{lang}> {t}"))
    r = client.post(f"{B}/chatbots/rag/chat", json={"message": "receta de pastel de chocolate", "language": "es"}, headers=auth("viewer")).json()
    assert r["reply"].startswith("<Spanish>") and "sufficient information" in r["reply"]


def test_agent_language_stored_and_final_instruction(client, auth, use):
    import json
    seen = []

    class Agent(Translator):
        def complete(self, system, messages, max_tokens=1024, temperature=0.2):
            seen.append(system)
            if "produce ONLY a plan" in system:
                return LLMResponse(json.dumps({"plan": ["answer"]}), "fake")
            return LLMResponse(json.dumps({"final": "Terminé."}), "fake")
    use(Agent())
    ex = client.post(f"{B}/agent/executions", json={"request": "quels fournisseurs ?", "language": "fr"}, headers=auth("buyer")).json()
    assert ex["language"] == "fr" and ex["final_result"] == "Terminé." and [x for x in seen if "produce ONLY a plan" not in x] and all("\"final\" answer in French" in x for x in seen if "produce ONLY a plan" not in x)
    assert client.post(f"{B}/agent/executions", json={"request": "x y z", "language": "zz"}, headers=auth("buyer")).status_code == 422


def test_compare_accepts_language(client, auth, use):
    use(Translator(to_english="payment terms"))
    r = client.post(f"{B}/compare/rule_based", json={"message": "condiciones de pago", "language": "es"}, headers=auth("buyer")).json()
    assert r["status"] == "ok" and r["reply"].startswith("[Spanish]") and r["language"] == "es"


def test_translate_prompt_protects_identifiers():
    class Spy(Translator): pass
    p = Spy(); prov.set_provider_override(p)
    try:
        i18n.translate("Order PO-2025074 for FAS-0001", "Hindi")
    finally:
        prov.set_provider_override(None)
    s = p.calls[0][0]
    assert "PO-2025074" in s and "SKU" in s and "ONLY the translation" in s and p.calls[0][1][0]["content"] == "Order PO-2025074 for FAS-0001"
