import re

# phrase-level synonyms are applied first, then token-level
PHRASES = {
    "sign off": "approval", "signed off": "approved", "waiting for": "awaiting", "running low": "low stock",
    "running out": "low stock", "out of stock": "low stock", "below reorder": "low stock", "need reordering": "low stock",
    "past due": "overdue", "behind schedule": "overdue", "not yet approved": "pending approval",
}
TOKENS = {
    "po": "purchase order", "pos": "purchase order", "orders": "purchase order", "order": "purchase order",
    "purchase orders": "purchase order", "requisition": "request", "requisitions": "request", "requests": "request",
    "inventory": "stock", "items": "product", "item": "product", "products": "product", "late": "overdue",
    "delayed": "overdue", "outstanding": "open", "active": "open", "awaiting": "pending", "waiting": "pending",
    "vendor": "supplier", "vendors": "supplier", "suppliers": "supplier", "sku": "product", "display": "show",
    "list": "show", "give": "show", "see": "show", "find": "show", "get": "show",
}
STOP = {"the", "a", "an", "me", "my", "is", "are", "of", "to", "for", "which", "what", "do", "we", "our", "still", "all", "please", "can", "you", "i", "that", "have", "any", "tell", "about", "me", "give", "who", "how", "when", "does", "there"}


def normalise(text: str) -> str:
    t = re.sub(r"[^a-z0-9\- ]", " ", text.lower())
    for k, v in PHRASES.items():
        t = t.replace(k, v)
    out, all_toks = [], []
    for tok in t.split():
        tok = TOKENS.get(tok, tok)
        all_toks.append(tok)
        if tok not in STOP:
            out.append(tok)
    if not out:  # message made only of stop words ("what can you do"): keep them rather than matching on nothing
        out = all_toks
    joined = re.sub(r"\s+", " ", " ".join(out)).strip()
    while "purchase purchase" in joined:  # keep normalisation idempotent
        joined = joined.replace("purchase purchase", "purchase")
    return joined
