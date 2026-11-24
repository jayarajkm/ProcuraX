import re
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import Supplier

STATUSES = {"draft": "draft", "approved": "approved", "sent": "sent", "received": "received", "cancelled": "cancelled", "canceled": "cancelled",
            "pending approval": "pending_approval", "partially received": "partially_received"}
SKU_RE = re.compile(r"\b[A-Z]{3}-\d{4}\b")
PO_RE = re.compile(r"\bPO-\d{7}\b", re.I)
REQ_RE = re.compile(r"\bREQ-\d{5}\b", re.I)


def extract(db: Session, text: str) -> dict:
    ents: dict = {}
    low = text.lower()
    if m := SKU_RE.search(text): ents["sku"] = m.group(0)
    if m := PO_RE.search(text): ents["po_number"] = m.group(0).upper()
    if m := REQ_RE.search(text): ents["request_number"] = m.group(0).upper()
    for phrase, st in STATUSES.items():
        if phrase in low: ents["status"] = st; break
    sups = list(db.scalars(select(Supplier)))
    for s in sups:
        if s.name.lower() in low or re.search(rf"\b{re.escape(s.code.lower())}\b", low):
            ents["supplier"] = {"id": s.id, "name": s.name}; break
    else:  # distinctive first word of a supplier name ("Apex", "Summit") if it identifies exactly one supplier
        firsts: dict[str, list] = {}
        for s in sups:
            firsts.setdefault(s.name.split()[0].lower(), []).append(s)
        for w, group in firsts.items():
            if len(group) == 1 and len(w) >= 4 and re.search(rf"\b{re.escape(w)}\b", low):
                ents["supplier"] = {"id": group[0].id, "name": group[0].name}; break
    for c in {s.country for s in sups if s.country}:
        if c.lower() in low:
            ents["country"] = c; break
    return ents
