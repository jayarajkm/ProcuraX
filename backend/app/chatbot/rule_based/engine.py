"""Deterministic rule engine. No LLM, no learning: pattern match -> template -> DB-resolved values."""
import re
import statistics
from collections import Counter
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot.types import ChatResult
from app.models import ChatbotConfiguration, ChatbotType, RuleDefinition, SupplierProduct, Supplier


def _config(db: Session, key: str) -> str:
    v = db.scalar(select(ChatbotConfiguration.value).join(ChatbotType).where(ChatbotType.slug == "rule_based", ChatbotConfiguration.key == key))
    return str(v["value"]) if v else "not configured"


def resolve_values(db: Session, source: str | None) -> tuple[dict, str]:
    """Resolve template placeholders from the database. Returns (values, source description)."""
    if source in (None, ""):
        return {}, "rule text"
    if source in ("approval_threshold", "working_hours"):
        return {source: _config(db, source)}, "chatbot_configurations"
    if source == "moq_stats":
        moqs = [m for (m,) in db.execute(select(SupplierProduct.min_order_qty))]
        return {"min_moq": min(moqs), "median_moq": int(statistics.median(moqs))}, "supplier_products"
    if source == "payment_terms":
        c = Counter(t for (t,) in db.execute(select(Supplier.payment_terms)))
        return {"top_payment_terms": ", ".join(f"{t} ({n} suppliers)" for t, n in c.most_common(3))}, "suppliers"
    return {}, "unknown"


def _score(p: str) -> int:
    return 4 if p.startswith("re:") else len(p)  # regex rules are generic: any specific phrase outranks them


def _matches(patterns: list[str], text: str) -> list[str]:
    hits = []
    for p in patterns:
        if p.startswith("re:"):
            if re.search(p[3:], text, re.I): hits.append(p)
        elif p.lower() in text:
            hits.append(p)
    return hits


def answer(db: Session, message: str, **_) -> ChatResult:
    text = message.lower().strip()
    rules = db.scalars(select(RuleDefinition).where(RuleDefinition.is_active).order_by(RuleDefinition.name)).all()
    best = None
    for r in rules:
        hits = _matches(r.patterns, text)
        if hits and (best is None or max(map(_score, hits)) > best[2]):
            best = (r, hits, max(map(_score, hits)))  # most specific (longest) pattern wins; ties -> alphabetical by rule name
    if not best:
        topics = ", ".join(r.name.replace("_", " ") for r in rules)
        return ChatResult(reply=f"I don't have a rule for that question. Topics I can answer: {topics}.",
                          approach="Rule engine: no pattern matched", steps=["Lowercased message", f"Checked {len(rules)} active rules", "No match"],
                          data_sources=["rule_definitions"])
    rule, hits, _ = best
    values, src = resolve_values(db, rule.value_source)
    return ChatResult(reply=rule.response_template.format(**values),
                      approach="Deterministic rule match (keyword/regex) -> response template",
                      data_sources=["rule_definitions"] + ([src] if src not in ("rule text",) else []),
                      steps=[f"Matched rule '{rule.name}' on pattern(s): {', '.join(hits)}", "Resolved template values from the database" if values else "Used static response text"])
