from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot.nlp import actions, entities
from app.chatbot.nlp.classifier import IntentClassifier, TfidfIntentClassifier
from app.chatbot.nlp.preprocess import normalise
from app.chatbot.types import ChatResult
from app.models import IntentDefinition, IntentExample

_cache: dict = {}


def get_classifier(db: Session) -> tuple[IntentClassifier, dict[str, str]]:
    """Trained from intent_examples rows; cached by example count (cheap to retrain)."""
    rows = db.execute(select(IntentDefinition.name, IntentDefinition.action, IntentExample.text).join(IntentExample)).all()
    key = len(rows)
    if _cache.get("key") != key:
        _cache.update(key=key, clf=TfidfIntentClassifier().fit([(n, t) for n, _, t in rows]), actions={n: a for n, a, _ in rows})
    return _cache["clf"], _cache["actions"]


def answer(db: Session, message: str, classifier: IntentClassifier | None = None, **_) -> ChatResult:
    clf, amap = get_classifier(db)
    clf = classifier or clf
    pred = clf.predict(message)
    ents = entities.extract(db, message)
    steps = [f"Preprocessed: '{normalise(message)}'", f"Top intents: {', '.join(f'{n}={s}' for n, s in pred.ranking)}",
             f"Entities: {', '.join(f'{k}={v['name'] if isinstance(v, dict) else v}' for k, v in ents.items()) or 'none'}"]
    override = None  # an explicit identifier in the message is a stronger signal than text similarity
    if "po_number" in ents and amap.get(pred.intent) != "show_purchase_order": override = ("show_purchase_order", "PO number")
    elif "request_number" in ents and amap.get(pred.intent) != "show_request": override = ("show_request", "request number")
    elif "sku" in ents and amap.get(pred.intent) != "show_product": override = ("show_product", "SKU")
    elif amap.get(pred.intent) == "show_purchase_order" and "status" in ents:  # "show approved purchase orders" is a list, not a lookup
        override = ("show_open_purchase_orders", "status word")
    elif pred.intent is None and "supplier" in ents: override = ("show_supplier", "supplier name")
    if override:
        res = actions.run(db, override[0], ents)
        res.approach = f"Entity-first routing: {override[1]} found in the message -> action '{override[0]}' -> read-only service query"
        res.confidence = res.confidence_kind = None  # the similarity score did not decide this route, so none is reported
        res.steps = steps + [f"Extracted {override[1]}; routed by entity (similarity classifier was {'below threshold' if pred.intent is None else 'pointing at ' + pred.intent})"]
        res.data_sources = ["entity extraction"] + res.data_sources
        return res
    if pred.intent is None:
        return ChatResult(reply="I couldn't confidently work out what you want. Try e.g. 'show open purchase orders', 'what is low on stock', or 'which orders are overdue'.",
                          approach="Intent classification (TF-IDF similarity) — below confidence threshold", confidence=pred.score,
                          confidence_kind="cosine similarity to best intent example (not a calibrated probability)",
                          steps=steps + ["Confidence below threshold; no action executed"], data_sources=["intent_examples"])
    res = actions.run(db, amap[pred.intent], ents)
    res.approach = f"Intent '{pred.intent}' recognised (TF-IDF similarity) -> action '{amap[pred.intent]}' -> read-only service query"
    res.confidence, res.confidence_kind = pred.score, "cosine similarity to best intent example (not a calibrated probability)"
    res.steps = steps + [f"Routed to action {amap[pred.intent]}"]
    res.data_sources = ["intent_examples"] + res.data_sources
    return res
