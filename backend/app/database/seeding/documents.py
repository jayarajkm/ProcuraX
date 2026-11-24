"""Ten synthetic procurement policy documents written to persistent upload storage."""
import os
from sqlalchemy.orm import Session
from app.models import Document

DOCS = [
    ("Purchase Approval Policy", "policy", "Purchases up to $5,000 may be approved by a Buyer's line manager. Purchases above $5,000 require Procurement Manager approval. Purchases above $50,000 additionally require Finance Director sign-off. Split orders to avoid thresholds are prohibited. All approvals are recorded in the approval history."),
    ("Supplier Onboarding Procedure", "procedure", "New suppliers must provide company registration, tax identification, bank verification and a signed code of conduct. Suppliers are rated after 90 days. High-risk categories require an on-site audit. Onboarding typically takes 10 business days."),
    ("Returns and Damages Policy", "policy", "Damaged goods must be reported within 5 business days of receipt with photographic evidence. Returns are authorised by the Procurement team via an RMA number. Credit notes are expected within 30 days. Repeated damage may trigger a supplier performance review."),
    ("Inventory Replenishment Guidelines", "guideline", "Reorder when available stock (on hand minus reserved) falls to the reorder level. Reorder level equals average daily demand times supplier lead time plus safety stock. Safety stock covers five days of demand by default. Review replenishment weekly."),
    ("Supplier Performance Review Standard", "standard", "Suppliers are scored on on-time delivery, quality, price competitiveness and responsiveness. A rating below 3.0 triggers a corrective action plan. Two consecutive quarters below 2.5 lead to suspension of new orders."),
    ("Procurement Working Hours and Contacts", "general", "The procurement desk is open Monday to Friday, 08:00 to 17:00. Urgent requests outside hours go to the on-call manager. Requests marked urgent are triaged within 2 hours during working hours."),
    ("Payment Terms Policy", "policy", "Standard payment terms are Net 30. Net 45 or Net 60 may be negotiated for strategic suppliers. Prepayment requires Procurement Manager approval. Early-payment discounts should be taken when the annualised return exceeds 10 percent."),
    ("Emergency Purchasing Procedure", "procedure", "In a stock-out affecting production, a Procurement Manager may authorise an emergency purchase from a non-preferred supplier. The justification must be recorded within 24 hours. Emergency purchases are reviewed monthly."),
    ("Supplier Code of Conduct", "policy", "Suppliers must comply with applicable labour, safety and environmental laws, prohibit bribery and child labour, and permit reasonable audits. Breaches may result in contract termination."),
    ("Goods Receipt and Inspection Procedure", "procedure", "Goods are checked against the purchase order on arrival: quantity, condition and documentation. Discrepancies are logged the same day. Partial receipts update the purchase order to Partially Received and the remainder stays open."),
]


def seed_documents(db: Session, org, user_id, upload_dir: str) -> int:
    os.makedirs(upload_dir, exist_ok=True)
    for i, (title, cat, body) in enumerate(DOCS, 1):
        fn = f"demo-{i:02d}-{title.lower().replace(' ', '-')}.txt"
        path = os.path.join(upload_dir, fn)
        text = f"{title}\n\n{body}\n\n(Synthetic demo document generated for ProcuraX AI.)\n"
        with open(path, "w") as f:
            f.write(text)
        db.add(Document(organization_id=org.id, title=title, filename=fn, file_type="txt", category=cat, storage_path=path,
                        size_bytes=len(text.encode()), status="uploaded", uploaded_by=user_id, meta={"synthetic": True}))
    return len(DOCS)
