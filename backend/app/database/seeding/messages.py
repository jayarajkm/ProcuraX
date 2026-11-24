"""Synthetic labelled supplier messages for ML training (templates x fillers; clearly synthetic)."""
T = {
    "supplier_complaint": ["{s} keeps sending damaged goods and the service has been poor", "We are unhappy with {s}; quality has dropped and nobody responds to our complaints",
                           "Formal complaint about {s}: repeated defective items in recent shipments", "The quality of items from {s} is unacceptable, we want a corrective action plan",
                           "{s} ignored our earlier complaint about faulty batches", "Poor workmanship on the last lot from {s}, please escalate"],
    "delivery_issue": ["The shipment from {s} arrived {n} days late", "Our delivery is delayed again, when will the order arrive", "Goods were delivered to the wrong warehouse",
                       "Order {po} has not arrived yet and the tracking shows no movement", "Partial delivery received, the rest of the order is missing", "Courier failed to deliver the pallets on the agreed date"],
    "pricing_issue": ["The unit price on {po} is higher than the agreed quote", "Why did the price increase by {n} percent this month", "Can you match the lower price offered by another supplier",
                      "Discount from the contract was not applied to the order", "We were quoted a different price than what appears on the confirmation", "Please review the pricing, it exceeds our budget"],
    "product_enquiry": ["Do you have {n} units of this item available", "Can you send the datasheet and specifications for the product", "Is this product compatible with our existing equipment",
                        "What is the minimum order quantity for this SKU", "Do you stock an alternative to the discontinued item", "Please share the available sizes and variants"],
    "invoice_issue": ["Invoice for {po} does not match the purchase order amount", "We received a duplicate invoice for the same shipment", "The invoice is missing the PO number and tax details",
                      "Please send a corrected invoice, the quantities are wrong", "Payment terms on the invoice differ from the contract", "We were billed for items we never received"],
    "general_procurement_enquiry": ["What is your standard onboarding process for new suppliers", "Can you explain the approval steps for large purchases", "Who should I contact about the procurement policy",
                                    "When is the next supplier review meeting", "How do I submit a new purchase request", "Please share the procurement calendar for next quarter"],
}
OPENERS = ["", "Hi team, ", "Hello, ", "Urgent: ", "Quick question - ", "FYI: "]


def generate_messages(rng, n, suppliers):
    labels = list(T)
    out = []
    for i in range(n):
        label = labels[i % len(labels)]
        s = rng.choice(suppliers)
        text = rng.choice(OPENERS) + rng.choice(T[label]).format(s=s.name, n=rng.randint(2, 20), po=f"PO-{2025000 + rng.randint(1, 150)}")
        out.append((text, label, s.id))
    return out
