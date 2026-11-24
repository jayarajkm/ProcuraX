"""Deterministic synthetic business data (fixed seed). All data is DEMO data."""
import math
import random
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.orm import Session
from app.models import *  # noqa

TAX = Decimal("0.10")
MONTHS_HISTORY = 8

CATEGORIES = {
    "Fasteners": (["Hex Bolt", "Socket Screw", "Lock Nut", "Flat Washer", "Self-Tapping Screw", "Anchor Bolt", "Rivet", "Threaded Rod"], "each", (0.05, 2.5)),
    "Electrical": (["Circuit Breaker", "Power Cable", "Terminal Block", "Relay", "Contactor", "LED Driver", "Fuse", "Junction Box"], "each", (3, 120)),
    "Bearings & Seals": (["Ball Bearing", "Roller Bearing", "Oil Seal", "O-Ring Kit", "Pillow Block", "Shaft Collar", "Gasket Set"], "each", (4, 90)),
    "Hydraulics": (["Hydraulic Hose", "Hydraulic Pump", "Check Valve", "Pressure Gauge", "Fitting Adapter", "Cylinder Seal Kit"], "each", (8, 450)),
    "Safety & PPE": (["Safety Gloves", "Safety Glasses", "Hard Hat", "Ear Defenders", "Hi-Vis Vest", "Respirator Mask", "Safety Boots"], "pair", (2, 85)),
    "Packaging": (["Cardboard Box", "Stretch Film", "Packing Tape", "Bubble Wrap", "Pallet Strap", "Corner Protector"], "pack", (4, 60)),
    "Cleaning Supplies": (["Degreaser", "Industrial Wipes", "Floor Cleaner", "Hand Soap", "Disinfectant Spray", "Mop Head"], "litre", (3, 40)),
    "Tools": (["Torque Wrench", "Cordless Drill", "Cutting Disc", "Socket Set", "Measuring Tape", "Utility Knife", "Angle Grinder"], "each", (6, 380)),
    "Lubricants": (["Machine Oil", "Grease Cartridge", "Cutting Fluid", "Penetrating Oil", "Hydraulic Oil", "Chain Lube"], "litre", (5, 70)),
    "Office Supplies": (["A4 Paper", "Printer Toner", "Ballpoint Pens", "Label Roll", "Whiteboard Marker", "Binder Folder"], "pack", (2, 120)),
    "IT Equipment": (["USB-C Dock", "Barcode Scanner", "Network Switch", "Label Printer", "Wireless Mouse", "Monitor Stand"], "each", (15, 520)),
    "Raw Materials": (["Steel Sheet", "Aluminium Bar", "Copper Wire", "PVC Pipe", "Rubber Sheet", "Timber Plank"], "kg", (2, 95)),
}
ADJ = ["Standard", "Heavy-Duty", "Industrial", "Premium", "Economy", "Precision", "Compact", "Extended"]
SIZES = ["M6", "M8", "M10", "S", "M", "L", "XL", "10mm", "25mm", "50mm", "1m", "5m", "250ml", "1L", "5L", "Type A", "Type B", "Pro"]
MANUFACTURERS = ["Norvex", "Kestrel Industrial", "Aldane", "Brightmoor", "Tarsus Works", "Helion Tech", "Orbis", "Vantor", "Quillon", "Stratos"]
SUP_A = ["Apex", "Meridian", "Summit", "Ironclad", "Northgate", "Bluewater", "Redwood", "Granite", "Pioneer", "Evergreen", "Silverline", "Falcon",
         "Crestview", "Harbor", "Atlas", "Zenith", "Lakeside", "Ridgeway", "Beacon", "Cobalt", "Sterling", "Orion", "Keystone", "Vanguard",
         "Titan", "Westbrook", "Eastfield", "Southport", "Highland", "Oakmont"]
SUP_B = ["Supply Co", "Industrial Ltd", "Trading", "Distribution", "Components", "Wholesale", "Logistics", "Materials"]
COUNTRIES = [("Germany", 12), ("China", 35), ("United States", 8), ("United Kingdom", 6), ("India", 28), ("Poland", 10), ("Mexico", 16), ("Vietnam", 32)]
CONTACTS = ["Sam Rivera", "Jordan Lee", "Casey Patel", "Taylor Nguyen", "Riley Schmidt", "Drew Kowalski", "Jamie Ortiz", "Avery Chen", "Quinn Murphy", "Robin Das"]
WAREHOUSES = [("WH-NORTH", "North Distribution Centre", "Leeds"), ("WH-SOUTH", "South Hub", "Bristol"), ("WH-EAST", "East Depot", "Norwich"),
              ("WH-WEST", "West Warehouse", "Cardiff"), ("WH-CENTRAL", "Central Fulfilment", "Birmingham")]
WH_SHARE = [0.3, 0.2, 0.15, 0.15, 0.2]
PATTERNS = ["steady", "seasonal", "spiky", "growing", "declining", "slow"]

PO_STATUS_WEIGHTS = [("received", 45), ("sent", 18), ("partially_received", 10), ("approved", 8), ("pending_approval", 9), ("draft", 5), ("cancelled", 5)]
REQ_STATUS_WEIGHTS = [("draft", 10), ("submitted", 10), ("pending_approval", 25), ("approved", 15), ("rejected", 15)]  # +converted derived from POs


def q2(x) -> Decimal:
    return Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def wchoice(rng, pairs):
    return rng.choices([p[0] for p in pairs], weights=[p[1] for p in pairs])[0]


def seed_business(db: Session, org: Organization, ref: dict, seed: int, today: date | None = None) -> dict:
    rng = random.Random(seed)
    today = today or date.today()
    users = ref["users"]
    stats = {}

    # --- categories & products (200)
    cats = {}
    for name in CATEGORIES:
        c = ProductCategory(organization_id=org.id, name=name, description=f"{name} items")
        db.add(c); cats[name] = c
    db.flush()
    products, used, n = [], set(), 0
    per_cat = [17] * 8 + [16] * 4  # 8*17+4*16 = 200
    for (cname, (nouns, uom, (lo, hi))), count in zip(CATEGORIES.items(), per_cat):
        made = 0
        while made < count:
            noun, adj, size = rng.choice(nouns), rng.choice(ADJ), rng.choice(SIZES)
            nm = f"{adj} {noun} {size}"
            if nm in used:
                continue
            used.add(nm); n += 1; made += 1
            price = q2(math.exp(rng.uniform(math.log(lo), math.log(hi))))
            p = Product(organization_id=org.id, category_id=cats[cname].id, sku=f"{cname[:3].upper()}-{n:04d}",
                        name=nm, description=f"{nm} for industrial and warehouse use.",
                        manufacturer=rng.choice(MANUFACTURERS), unit_of_measure=uom, unit_price=price,
                        is_active=rng.random() > 0.04)
            db.add(p); products.append(p)
    db.flush()

    # --- suppliers (30)
    suppliers = []
    for i in range(30):
        country, base_lt = COUNTRIES[i % len(COUNTRIES)]
        nm = f"{SUP_A[i]} {rng.choice(SUP_B)}"
        s = Supplier(organization_id=org.id, code=f"SUP-{i+1:03d}", name=nm, contact_person=rng.choice(CONTACTS),
                     email=f"orders@{SUP_A[i].lower()}-demo.example", phone=f"+44 20 7946 {rng.randint(1000, 9999)}",
                     address=f"{rng.randint(1, 250)} Industrial Way, {country}", country=country,
                     payment_terms=rng.choice(["Net 30", "Net 30", "Net 45", "Net 60", "Prepaid"]),
                     avg_lead_time_days=max(3, base_lt + rng.randint(-3, 5)),
                     rating=q2(min(5, max(2.0, rng.gauss(3.8, 0.6)))), is_active=i < 28)
        db.add(s); suppliers.append(s)
    db.flush()

    # --- supplier_products: each product 2-4 suppliers, differing prices
    sp_by_supplier, sp_by_product = defaultdict(list), defaultdict(list)
    for p in products:
        for s in rng.sample(suppliers, rng.randint(2, 4)):
            lt = max(2, s.avg_lead_time_days + rng.randint(-2, 4))
            sp = SupplierProduct(supplier_id=s.id, product_id=p.id, unit_price=q2(p.unit_price * Decimal(str(rng.uniform(0.88, 1.18)))),
                                 lead_time_days=lt, min_order_qty=rng.choice([1, 5, 10, 25, 50, 100]))
            db.add(sp); sp_by_supplier[s.id].append(sp); sp_by_product[p.id].append(sp)
    for plist in sp_by_product.values():  # cheapest reliable one is preferred
        min(plist, key=lambda x: x.unit_price).is_preferred = True
    db.flush()
    sup_by_id = {s.id: s for s in suppliers}

    # --- warehouses
    whs = [Warehouse(organization_id=org.id, code=c, name=n_, location=l) for c, n_, l in WAREHOUSES]
    db.add_all(whs); db.flush()

    # --- demand history (monthly buckets, 8 months, per product/warehouse = 8000 rows)
    prod_pattern = {p.id: rng.choice(PATTERNS) for p in products}
    base_daily = {}
    for p in products:
        pat = prod_pattern[p.id]
        base_daily[p.id] = rng.uniform(0.2, 1.5) if pat == "slow" else math.exp(rng.uniform(math.log(1.5), math.log(40)))
    demand = defaultdict(list)  # (pid, wid) -> monthly quantities, oldest first
    first_of_month = today.replace(day=1)
    month_starts = []
    d = first_of_month
    for _ in range(MONTHS_HISTORY):
        d = (d - timedelta(days=1)).replace(day=1); month_starts.append(d)
    month_starts.reverse()
    for p in products:
        pat = prod_pattern[p.id]
        for w, share in zip(whs, WH_SHARE):
            for mi, ms in enumerate(month_starts):
                f = {"steady": 1.0, "slow": 1.0, "seasonal": 1 + 0.4 * math.sin(2 * math.pi * ms.month / 12),
                     "growing": 0.7 + 0.08 * mi, "declining": 1.3 - 0.08 * mi, "spiky": rng.choice([0.6, 0.8, 1.0, 2.2])}[pat]
                qty = max(0, int(round(base_daily[p.id] * share * 30 * f * rng.uniform(0.85, 1.15))))
                db.add(DemandHistory(product_id=p.id, warehouse_id=w.id, demand_date=ms, quantity=qty))
                demand[(p.id, w.id)].append(qty)
    db.flush()
    stats["demand_history"] = len(products) * len(whs) * MONTHS_HISTORY

    # --- purchase orders (150, 400 lines, consistent with supplier catalogues)
    active_sups = [s for s in suppliers if s.is_active]
    extra = [0] * 150
    for _ in range(250):
        i = rng.randrange(150)
        while extra[i] >= 4:
            i = rng.randrange(150)
        extra[i] += 1
    pos, on_order = [], defaultdict(int)
    for i in range(150):
        s = rng.choice(active_sups)
        status = wchoice(rng, PO_STATUS_WEIGHTS)
        wh = rng.choice(whs)
        age = {"received": rng.randint(20, 160), "partially_received": rng.randint(15, 50), "sent": rng.randint(5, 45),
               "approved": rng.randint(1, 10), "pending_approval": rng.randint(0, 6), "draft": rng.randint(0, 4), "cancelled": rng.randint(5, 90)}[status]
        order_date = today - timedelta(days=age)
        offered = rng.sample(sp_by_supplier[s.id], min(len(sp_by_supplier[s.id]), 1 + extra[i]))
        lead = max(sp.lead_time_days for sp in offered)
        po = PurchaseOrder(organization_id=org.id, po_number=f"PO-{2025000 + i + 1}", supplier_id=s.id, warehouse_id=wh.id,
                           created_by=users["Buyer"].id, status=status, order_date=order_date,
                           expected_delivery_date=order_date + timedelta(days=lead))
        subtotal = Decimal(0); tax = Decimal(0)
        for sp in offered:
            qty = max(sp.min_order_qty, rng.choice([10, 20, 50, 100, 200, 400]))
            lt = q2(sp.unit_price * qty)
            received = {"received": qty, "partially_received": int(qty * rng.uniform(0.2, 0.7))}.get(status, 0)
            line = PurchaseOrderLine(product_id=sp.product_id, quantity=qty, quantity_received=received,
                                     unit_price=sp.unit_price, tax_rate=TAX, line_total=lt)
            po.lines.append(line); subtotal += lt; tax += q2(lt * TAX)
            if status in ("approved", "sent", "partially_received"):
                on_order[(sp.product_id, wh.id)] += qty - received
        po.subtotal, po.tax_amount, po.total_amount = subtotal, tax, subtotal + tax
        if status == "received":
            delay = rng.choice([0, 0, 0, 1, 2, 4, 7, 10]) if rng.random() < 0.75 else rng.randint(-2, 0)
            po.actual_delivery_date = min(today, po.expected_delivery_date + timedelta(days=delay))
        # status history path
        path = {"draft": ["draft"], "pending_approval": ["draft", "pending_approval"], "approved": ["draft", "pending_approval", "approved"],
                "sent": ["draft", "pending_approval", "approved", "sent"],
                "partially_received": ["draft", "pending_approval", "approved", "sent", "partially_received"],
                "received": ["draft", "pending_approval", "approved", "sent", "received"],
                "cancelled": ["draft", "pending_approval", "cancelled"]}[status]
        prev = None
        for k, st in enumerate(path):
            po.history.append(PurchaseOrderStatusHistory(from_status=prev, to_status=st, changed_by=users["Procurement Manager"].id if st in ("approved", "cancelled") else users["Buyer"].id,
                                                         changed_at=datetime.combine(order_date + timedelta(days=k), datetime.min.time(), tzinfo=timezone.utc)))
            prev = st
        db.add(po); pos.append(po)
    db.flush()
    stats["po_lines"] = sum(len(p.lines) for p in pos)

    # --- inventory (200 x 5 = 1000) with varied scenarios
    inv_rows = []
    for p in products:
        sps = sp_by_product[p.id]
        pref_lt = next(sp.lead_time_days for sp in sps if sp.is_preferred)
        for w in whs:
            series = demand[(p.id, w.id)]
            avg_daily = Decimal(str(round(sum(series[-3:]) / 90, 2)))
            safety = int(math.ceil(float(avg_daily) * 5))
            reorder = int(math.ceil(float(avg_daily) * pref_lt)) + safety
            scenario = rng.choices(["critical", "low", "healthy", "overstock"], weights=[10, 14, 61, 15])[0]
            factor = {"critical": rng.uniform(0.05, 0.6), "low": rng.uniform(0.7, 1.0), "healthy": rng.uniform(1.3, 2.5), "overstock": rng.uniform(3, 5)}[scenario]
            on_hand = max(0, int(reorder * factor))
            reserved = int(on_hand * rng.uniform(0, 0.25))
            inv = Inventory(product_id=p.id, warehouse_id=w.id, quantity_on_hand=on_hand, quantity_reserved=reserved,
                            quantity_on_order=on_order.get((p.id, w.id), 0), reorder_level=reorder, safety_stock=safety,
                            avg_daily_demand=avg_daily)
            db.add(inv); inv_rows.append(inv)
    db.flush()
    for inv in rng.sample(inv_rows, 300):  # movement history sample (receipts/issues)
        for k in range(rng.randint(2, 5)):
            t = rng.choice(["receipt", "issue", "issue", "adjustment"])
            qty = rng.randint(5, 80) * (1 if t == "receipt" else -1 if t == "issue" else rng.choice([-1, 1]))
            db.add(InventoryMovement(inventory_id=inv.id, movement_type=t, quantity=qty, reference=f"{t[:3].upper()}-{rng.randint(10000, 99999)}",
                                     occurred_at=datetime.now(timezone.utc) - timedelta(days=rng.randint(0, 60))))

    # --- purchase requests: 15 converted (linked to real POs) + 85 in other states = 100
    reqs = []
    n_req = 0

    def mk_request(status, lines, po=None):
        nonlocal n_req
        n_req += 1
        r = PurchaseRequest(organization_id=org.id, request_number=f"REQ-{n_req:05d}", requested_by=users["Buyer"].id,
                            justification=rng.choice(["Stock below reorder level", "Upcoming project demand", "Supplier price improvement",
                                                      "Replace damaged stock", "Seasonal demand increase"]),
                            priority=rng.choices(["low", "medium", "high", "urgent"], weights=[15, 50, 25, 10])[0],
                            status=status, requested_delivery_date=today + timedelta(days=rng.randint(7, 45)))
        for pid, sid, qty in lines:
            r.lines.append(PurchaseRequestLine(product_id=pid, suggested_supplier_id=sid, quantity=qty))
        db.add(r); reqs.append(r)
        return r

    convertible = [p for p in pos if p.status in ("approved", "sent", "partially_received", "received")]
    for po in rng.sample(convertible, 15):
        r = mk_request("converted", [(l.product_id, po.supplier_id, l.quantity) for l in po.lines])
        db.flush(); po.source_request_id = r.id
    for _ in range(85):
        status = wchoice(rng, REQ_STATUS_WEIGHTS)
        lines = []
        for p in rng.sample(products, rng.randint(1, 3)):
            sp = rng.choice(sp_by_product[p.id])
            lines.append((p.id, sp.supplier_id, rng.choice([20, 50, 100, 250])))
        mk_request(status, lines)
    db.flush()
    for r in reqs:
        if r.status in ("draft",):
            continue
        wf = ApprovalWorkflow(entity_type="purchase_request", entity_id=r.id, required_permission="request:approve",
                              status={"approved": "approved", "converted": "approved", "rejected": "rejected"}.get(r.status, "pending"))
        db.add(wf); db.flush()
        db.add(ApprovalHistory(workflow_id=wf.id, action="submitted", actor_id=users["Buyer"].id, comment="Submitted for approval"))
        if r.status in ("approved", "converted", "rejected"):
            db.add(ApprovalHistory(workflow_id=wf.id, action="rejected" if r.status == "rejected" else "approved",
                                   actor_id=users["Procurement Manager"].id,
                                   comment="Budget not available" if r.status == "rejected" else "Approved"))
    db.flush()

    # --- supplier messages (300 labelled)
    from app.database.seeding.messages import generate_messages
    for text, label, sid in generate_messages(rng, 300, suppliers):
        db.add(SupplierMessage(supplier_id=sid, text=text, label=label))

    stats.update(products=len(products), suppliers=len(suppliers), warehouses=len(whs), inventory=len(inv_rows),
                 purchase_orders=len(pos), purchase_requests=len(reqs), supplier_messages=300)
    return stats
