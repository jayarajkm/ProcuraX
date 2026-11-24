"""Reference/config data: org, RBAC, demo users, chatbot catalogue, intents, rules, tools, prompts."""
from sqlalchemy.orm import Session
from app.core.security import hash_password
from app.models import *  # noqa

DEMO_PASSWORD = "Demo@12345"  # demo accounts only; documented in README

PERMISSIONS = [
    "product:read", "product:write", "supplier:read", "supplier:write", "inventory:read", "inventory:write",
    "po:read", "po:write", "po:approve", "request:read", "request:write", "request:approve",
    "document:read", "document:write", "chat:use", "agent:run", "agent:approve", "ml:read", "ml:train",
    "admin:manage",
]
ROLE_PERMS = {
    "Administrator": PERMISSIONS,
    "Procurement Manager": [p for p in PERMISSIONS if p != "admin:manage"],
    "Buyer": ["product:read", "supplier:read", "inventory:read", "po:read", "po:write", "request:read",
              "request:write", "document:read", "document:write", "chat:use", "agent:run", "ml:read"],
    "Viewer": ["product:read", "supplier:read", "inventory:read", "po:read", "request:read",
               "document:read", "chat:use", "ml:read"],
}
DEMO_USERS = [
    ("admin@procurax.demo", "Alex Admin", "Administrator"),
    ("manager@procurax.demo", "Morgan Manager", "Procurement Manager"),
    ("buyer@procurax.demo", "Blake Buyer", "Buyer"),
    ("viewer@procurax.demo", "Val Viewer", "Viewer"),
]

CHATBOTS = [
    ("rule_based", "Rule-Based Chatbot", False,
     "Answers fixed questions with deterministic, predefined rules.",
     "A Python rule engine matches keywords/regex patterns to response templates. Business values (thresholds, minimum quantities) are read live from the database. No AI model is involved, so answers are 100% predictable.",
     ["Policy FAQs", "Working hours", "Approval thresholds"],
     ["What is the purchase approval threshold?", "What are the procurement working hours?", "What is the minimum reorder quantity?"]),
    ("nlp", "NLP / Intent Chatbot", False,
     "Understands different phrasings of the same request and routes them to the right action.",
     "Text is normalised, synonyms are mapped, and a TF-IDF similarity classifier scores the message against example phrases for each intent. Entities (statuses, supplier names, SKUs) are extracted and the intent is routed to a backend service. The classifier is behind an interface so it can be replaced.",
     ["Order lookups", "Status queries", "Self-service reporting"],
     ["Show me my open purchase orders.", "Which POs are still pending?", "List orders awaiting approval."]),
    ("ml", "Machine Learning Chatbot", False,
     "Uses trained scikit-learn models to classify messages and predict stockout risk.",
     "Two models: a TF-IDF + logistic regression message classifier, and a gradient-boosting stockout-risk model trained on demand and inventory features. Models are versioned, persisted and evaluated; confidence scores are real model probabilities.",
     ["Triage supplier messages", "Stockout prediction", "Replenishment planning"],
     ["Which products are at risk of stockout?", "Classify: The shipment arrived two weeks late again", "Predict replenishment needs for the next 14 days"]),
    ("generative", "Generative AI Chatbot", True,
     "Conversational assistant that summarises and explains procurement data.",
     "A large language model (via a configurable provider) receives your question, conversation history and a snapshot of relevant database facts, then writes a natural-language answer. Requires an LLM API key.",
     ["Business summaries", "Supplier comparison", "Explaining inventory risk"],
     ["Summarise our current procurement position.", "Compare our top suppliers by lead time and rating.", "Why are some products low on stock?"]),
    ("rag", "RAG Chatbot", True,
     "Answers from your uploaded documents, with citations.",
     "Documents are split into chunks, embedded with a local model and stored in PostgreSQL (pgvector). For each question the most similar chunks are retrieved and given to the LLM, which must answer only from them and cite sources. If nothing relevant is found it says so.",
     ["Policy Q&A", "Contract lookups", "Onboarding support"],
     ["What is our approval policy for purchases over the threshold?", "What are the supplier onboarding requirements?", "What does the returns policy say?"]),
    ("agentic", "Agentic AI Assistant", True,
     "Plans multi-step tasks and runs controlled tools, asking for approval before acting.",
     "An LLM plans steps and calls a closed registry of validated backend tools (inventory, suppliers, reorder calculation, purchase requests). It cannot run SQL or shell commands, and consequential actions pause for human approval. Every step is logged.",
     ["Automated replenishment", "Supplier price comparison", "Exception handling"],
     ["Find products that may run out within the next seven days and prepare purchase requests.", "Compare supplier prices for our lowest-stock product.", "What is the status of my open purchase orders?"]),
]

INTENTS = {
    "list_open_pos": ("show_open_purchase_orders", ["show me my open purchase orders", "list open POs", "where are my orders", "which purchase orders are open", "what orders are still outstanding", "display active purchase orders"]),
    "list_pending_pos": ("show_pending_approval_pos", ["which POs are still pending", "list orders awaiting approval", "purchase orders pending approval", "what needs approval", "show orders waiting for sign off"]),
    "list_low_stock": ("show_low_stock", ["which products are low on stock", "show low inventory items", "what is running low", "items below reorder level", "list products that need reordering"]),
    "list_overdue_pos": ("show_overdue_pos", ["which orders are late", "show delayed purchase orders", "overdue deliveries", "orders past expected delivery date", "what shipments are delayed"]),
    "list_pending_requests": ("show_pending_requests", ["show pending purchase requests", "which requests await approval", "list procurement requests pending", "open requisitions", "requests not yet approved"]),
    "supplier_lookup": ("show_supplier", ["tell me about supplier", "show supplier details", "who is our supplier", "find supplier information", "supplier contact details"]),
    "po_lookup": ("show_purchase_order", ["status of purchase order", "details of purchase order", "show purchase order details", "where is my purchase order", "track purchase order", "tell me about purchase order"]),
    "request_lookup": ("show_request", ["status of purchase request", "details of request", "show request details", "track my request", "what happened to my request"]),
    "po_summary": ("show_po_summary", ["how many purchase orders do we have", "purchase order summary", "count of orders by status", "order status breakdown", "how many orders are there"]),
    "reorder_recommendations": ("show_reorder", ["what should I reorder", "what needs to be reordered", "reorder recommendations", "suggest reorder quantities", "what should we buy"]),
    "list_suppliers": ("list_suppliers", ["list all suppliers", "show suppliers", "who are our suppliers", "top suppliers", "suppliers in a country", "show me our vendors"]),
    "supplier_orders": ("show_supplier_orders", ["orders from supplier", "purchase orders for supplier", "show POs for supplier", "what did we order from supplier", "supplier order history"]),
    "greeting": ("reply_greeting", ["hello", "hi", "hey there", "good morning"]),
    "help": ("reply_help", ["help", "what can you do", "what can I ask", "how do I use this", "show me examples"]),
    "thanks": ("reply_thanks", ["thanks", "thank you", "great thanks", "cheers"]),
    "product_lookup": ("show_product", ["find product", "search for a product", "show product details", "look up item by sku", "do we stock this item"]),
}

RULES = [
    ("approval_threshold", ["approval threshold", "approval limit", "need approval", "approve purchases"],
     "Purchases above ${approval_threshold} require Procurement Manager approval.", "approval_threshold"),
    ("working_hours", ["working hours", "office hours", "when is procurement open", "business hours"],
     "The procurement team works {working_hours}.", "working_hours"),
    ("min_reorder_qty", ["minimum reorder", "min reorder", "minimum order quantity", "moq"],
     "The smallest minimum order quantity across supplier catalogue entries is {min_moq} units; the typical (median) MOQ is {median_moq}.", "moq_stats"),
    ("payment_terms", ["payment terms", "when do we pay", "net 30"],
     "Most common supplier payment terms: {top_payment_terms}.", "payment_terms"),
    ("greeting", ["re:^\\s*(hi|hello|hey|good (morning|afternoon|evening))\\b"],
     "Hello! I answer fixed procurement policy questions. Ask about the approval threshold, working hours, minimum order quantity, payment terms, PO statuses or how approval works.", None),
    ("help", ["help", "what can you do", "what can i ask", "what do you know"],
     "I'm the rule-based bot: I match your question to predefined rules. I can answer: approval threshold, working hours, minimum reorder quantity, payment terms, purchase order statuses, and how approval works. For live data lookups try the NLP bot.", None),
    ("approval_process", ["how does approval work", "who approves", "approval process", "who can approve", "approval workflow", "how are requests approved"],
     "Purchase requests go Draft -> Submitted -> Pending Approval -> Approved or Rejected -> Converted to a purchase order. Approving needs a Procurement Manager or Administrator, and purchases above ${approval_threshold} require Procurement Manager approval.", "approval_threshold"),
    ("thanks", ["thank you", "thanks", "cheers"], "You're welcome!", None),
    ("po_statuses", ["po statuses", "purchase order statuses", "order lifecycle", "purchase order stages"],
     "Purchase orders move through: Draft, Pending Approval, Approved, Sent, Partially Received, Received, or Cancelled.", None),
]

POLICY_VALUES = {"approval_threshold": "5000", "working_hours": "Monday-Friday, 08:00-17:00 (local time)",
                 "review_days": "7", "default_tax_rate": "0.10"}

TOOLS = [
    ("search_products", "Search products by name, SKU or category.", "product:read", False),
    ("get_inventory", "Get inventory levels for a product across warehouses.", "inventory:read", False),
    ("get_low_stock_items", "List products at or below reorder level, or projected to run out within N days.", "inventory:read", False),
    ("search_suppliers", "Search suppliers by name or country.", "supplier:read", False),
    ("get_supplier_products", "List products offered by a supplier with prices.", "supplier:read", False),
    ("get_supplier_lead_times", "Get lead times for suppliers of a product.", "supplier:read", False),
    ("calculate_reorder_quantity", "Calculate suggested reorder quantity for a product.", "inventory:read", False),
    ("compare_supplier_prices", "Compare supplier prices and lead times for a product.", "supplier:read", False),
    ("get_purchase_order_status", "Get status of purchase orders by number or status.", "po:read", False),
    ("create_purchase_request", "Create a DRAFT purchase request (sensitive: requires human approval).", "request:write", True),
    ("submit_purchase_request", "Submit a purchase request for approval (sensitive).", "request:write", True),
]

PROMPTS = [
    ("generative_system", "You are ProcuraX, a procurement assistant. Answer using ONLY the provided database facts. If facts are insufficient, say so. Be concise and structured.", ["facts", "history"]),
    ("rag_system", "Answer the question using ONLY the numbered context passages. Cite passages like [1]. If the context does not contain the answer, reply exactly that the uploaded knowledge base does not contain sufficient information.", ["context", "question"]),
    ("agent_planner", "You are a procurement planning agent. Produce a short plan using only the listed tools. Never invent tool names.", ["tools", "request"]),
]


def seed_reference(db: Session, org: Organization) -> dict:
    perms = {c: Permission(code=c, description=c.replace(":", " ").title()) for c in PERMISSIONS}
    db.add_all(perms.values())
    roles = {}
    for name, codes in ROLE_PERMS.items():
        r = Role(name=name, permissions=[perms[c] for c in codes])
        roles[name] = r
        db.add(r)
    users = {}
    pw = hash_password(DEMO_PASSWORD)
    for email, full, role in DEMO_USERS:
        u = User(organization_id=org.id, email=email, full_name=full, password_hash=pw, roles=[roles[role]])
        users[role] = u
        db.add(u)

    types = {}
    for slug, name, llm, desc, tech, uses, prompts in CHATBOTS:
        t = ChatbotType(slug=slug, name=name, requires_llm=llm, description=desc, technology=tech,
                        use_cases=uses, example_prompts=prompts)
        types[slug] = t
        db.add(t)
    db.flush()
    for k, v in POLICY_VALUES.items():
        db.add(ChatbotConfiguration(chatbot_type_id=types["rule_based"].id, key=k, value={"value": v}))
    for name, (action, examples) in INTENTS.items():
        i = IntentDefinition(name=name, action=action, description=name.replace("_", " "))
        db.add(i)
        db.flush()
        db.add_all(IntentExample(intent_id=i.id, text=e) for e in examples)
    for name, patterns, tmpl, src in RULES:
        db.add(RuleDefinition(name=name, patterns=patterns, response_template=tmpl, value_source=src))
    for name, desc, perm, sens in TOOLS:
        db.add(AgentToolRegistry(name=name, description=desc, input_schema={}, required_permission=perm, is_sensitive=sens))
    db.add(AgentDefinition(name="procurement_agent", system_prompt=PROMPTS[2][1], max_iterations=10, timeout_seconds=120))
    for n, t, v in PROMPTS:
        db.add(PromptTemplate(name=n, template=t, variables=v))
    db.add(AIProviderConfiguration(provider="anthropic", model="claude-sonnet-5-5",
                                   api_key_env_var="ANTHROPIC_API_KEY", is_default=True))
    db.flush()
    return {"users": users, "roles": roles, "types": types}


def sync_reference(db: Session) -> dict:
    """Idempotent: add intents/examples/rules introduced after the first seed (never overwrites admin edits to existing rules' text)."""
    from sqlalchemy import select
    added = {"intents": 0, "examples": 0, "rules": 0, "rule_patterns": 0}
    have = {i.name: i for i in db.scalars(select(IntentDefinition))}
    for name, (action, examples) in INTENTS.items():
        i = have.get(name)
        if not i:
            i = IntentDefinition(name=name, action=action, description=name.replace("_", " ")); db.add(i); db.flush(); added["intents"] += 1
        existing = {e.text for e in db.scalars(select(IntentExample).where(IntentExample.intent_id == i.id))}
        for t in examples:
            if t not in existing:
                db.add(IntentExample(intent_id=i.id, text=t)); added["examples"] += 1
    rules = {r.name: r for r in db.scalars(select(RuleDefinition))}
    for name, patterns, tmpl, src in RULES:
        r = rules.get(name)
        if not r:
            db.add(RuleDefinition(name=name, patterns=patterns, response_template=tmpl, value_source=src)); added["rules"] += 1
        else:
            missing = [p for p in patterns if p not in r.patterns]
            if missing:
                r.patterns = [*r.patterns, *missing]; added["rule_patterns"] += len(missing)
    db.flush()
    return added
