"""Generative chatbot: LLM + live database facts + conversation history."""
import re
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot.generative.provider import ProviderError, ProviderNotConfigured, get_provider
from app.chatbot import i18n
from app.chatbot.types import ChatResult
from app.models import PromptTemplate, Supplier
from app.services import dashboard, queries as q


def build_facts(db: Session, message: str) -> tuple[str, list[str]]:
    """Collect only relevant facts from the database (read-only service calls)."""
    low = message.lower()
    d = dashboard.overview(db)
    sources = ["dashboard aggregates"]
    parts = [f"Overview: {d['total_products']} products, {d['total_suppliers']} suppliers, inventory value {d['inventory_value']:.0f}, "
             f"{d['low_stock_products']} products with low stock, {d['open_purchase_orders']} open POs ({d['overdue_purchase_orders']} overdue), "
             f"{d['pending_purchase_requests']} pending purchase requests. PO status counts: {d['po_status_breakdown']}."]
    if re.search(r"stock|reorder|inventory|run out|low", low):
        t, rows = q.low_stock(db, limit=10)
        parts.append(f"Low-stock records ({t} total), lowest days-of-cover first: " + "; ".join(
            f"{r['sku']} {r['product_name']} @ {r['warehouse']}: available {r['available']}, reorder level {r['reorder_level']}, days cover {r['days_of_cover']}" for r in rows))
        sources += ["inventory", "products"]
    if re.search(r"supplier|vendor|lead time|compare|rating", low):
        sups = list(db.scalars(select(Supplier).where(Supplier.is_active).order_by(Supplier.rating.desc()).limit(10)))
        parts.append("Top suppliers by rating: " + "; ".join(f"{s.name} ({s.code}, {s.country}) rating {s.rating}, avg lead {s.avg_lead_time_days}d, terms {s.payment_terms}" for s in sups))
        parts.append("Supplier delivery performance (top by order volume): " + "; ".join(
            f"{p['name']}: on-time {p['on_time_rate']}" for p in d["supplier_performance"]))
        sources += ["suppliers", "purchase_orders"]
    if re.search(r"order|\bpo\b|delivery|overdue|late|delay", low):
        t, pos = q.purchase_orders(db, overdue=True, limit=8)
        parts.append(f"Overdue POs ({t}): " + "; ".join(f"{p.po_number} expected {p.expected_delivery_date} status {p.status}" for p in pos))
        sources.append("purchase_orders")
    return "\n".join(parts), sorted(set(sources))


def answer(db: Session, message: str, history: list[dict] | None = None, language: str = "en", english_query: str | None = None, **_) -> ChatResult:
    try:
        provider = get_provider()
    except ProviderNotConfigured as e:
        return ChatResult(reply=str(e), approach="Generative AI: provider not configured", data_sources=[], steps=["No LLM call was made"], status="not_configured")
    facts, sources = build_facts(db, english_query or message)
    tmpl = db.scalar(select(PromptTemplate.template).where(PromptTemplate.name == "generative_system"))
    system = f"{tmpl}\n\nDATABASE FACTS (synthetic demo data):\n{facts}" + i18n.instruction(language)
    msgs = [{"role": m["role"], "content": m["content"]} for m in (history or [])[-10:]] + [{"role": "user", "content": message}]
    try:
        r = provider.complete(system, msgs, max_tokens=900)
    except ProviderError as e:
        return ChatResult(reply=f"The LLM provider returned an error: {e}", approach="Generative AI: provider error", data_sources=sources, status="provider_error")
    return ChatResult(reply=r.text, approach=f"LLM ({provider.name}:{r.model}) with database facts + conversation history", data_sources=sources,
                      steps=["Collected relevant facts from the database via read-only services", f"Sent {len(msgs)} message(s) plus facts to the LLM"],
                      extra={"model": r.model, "input_tokens": r.input_tokens, "output_tokens": r.output_tokens})
