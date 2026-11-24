"""Feature engineering for the inventory models.

Demand history is monthly per (product, warehouse). A training window uses 3 consecutive months to
predict the FOLLOWING month. IMPORTANT: historical stock levels are not stored in the database, so
for stockout-risk TRAINING a stock level is SIMULATED per window (seeded RNG). At inference the real
current inventory is used. This is recorded in model metadata.
"""
import math
from collections import defaultdict
import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import DemandHistory, Product, SupplierProduct

DEMAND_FEATURES = ["avg_daily", "last_daily", "trend", "cv", "month_sin", "month_cos", "lead_time", "log_price"]
RISK_FEATURES = DEMAND_FEATURES + ["cover_ratio", "cover_days"]


def load_series(db: Session) -> dict:
    s = defaultdict(list)
    for r in db.execute(select(DemandHistory.product_id, DemandHistory.warehouse_id, DemandHistory.demand_date, DemandHistory.quantity)
                        .order_by(DemandHistory.demand_date)):
        s[(r[0], r[1])].append((r[2], r[3]))
    return s


def product_context(db: Session) -> dict:
    lead = {}
    for sp in db.scalars(select(SupplierProduct).where(SupplierProduct.is_preferred)):
        lead[sp.product_id] = sp.lead_time_days
    price = {p.id: float(p.unit_price) for p in db.scalars(select(Product))}
    return {"lead": lead, "price": price}


def window_features(hist: list[int], target_month: int, lead: int, price: float) -> dict:
    m = np.array(hist, dtype=float)
    mean = m.mean()
    return {
        "avg_daily": mean / 30, "last_daily": m[-1] / 30,
        "trend": (m[-1] + 1) / (m[:-1].mean() + 1),
        "cv": float(m.std() / (mean + 1e-6)),
        "month_sin": math.sin(2 * math.pi * target_month / 12), "month_cos": math.cos(2 * math.pi * target_month / 12),
        "lead_time": lead, "log_price": math.log1p(price),
    }


def build_training_frame(db: Session, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    series, ctx = load_series(db), product_context(db)
    rows = []
    for (pid, wid), pts in series.items():
        qty = [q for _, q in pts]
        for t in range(3, len(qty)):
            f = window_features(qty[t - 3:t], pts[t][0].month, ctx["lead"][pid], ctx["price"][pid])
            f["target_daily"] = qty[t] / 30
            stock = max(1.0, f["avg_daily"] * f["lead_time"] * rng.uniform(0.4, 2.2))  # simulated stock (see module docstring)
            f["cover_ratio"] = stock / (f["avg_daily"] * f["lead_time"] + 1e-6)
            f["cover_days"] = stock / (f["avg_daily"] + 1e-6)
            f["stockout"] = int(f["target_daily"] * f["lead_time"] > stock)
            f["window"] = t
            rows.append(f)
    return pd.DataFrame(rows)


def inference_frame(db: Session) -> pd.DataFrame:
    """Features for every current inventory record using REAL stock levels."""
    from app.models import Inventory
    series, ctx = load_series(db), product_context(db)
    rows = []
    for inv in db.scalars(select(Inventory)).unique():
        pts = series.get((inv.product_id, inv.warehouse_id), [])
        if len(pts) < 3:
            continue
        last = pts[-3:]
        nxt_month = (last[-1][0].month % 12) + 1
        f = window_features([q for _, q in last], nxt_month, ctx["lead"][inv.product_id], ctx["price"][inv.product_id])
        avail = inv.quantity_on_hand - inv.quantity_reserved
        stock = max(1.0, float(avail))
        f["cover_ratio"] = stock / (f["avg_daily"] * f["lead_time"] + 1e-6)
        f["cover_days"] = stock / (f["avg_daily"] + 1e-6)
        f.update(inventory_id=inv.id, product_id=inv.product_id, sku=inv.product.sku, product_name=inv.product.name,
                 warehouse=inv.warehouse.name, available=avail, projected=avail + inv.quantity_on_order,
                 safety_stock=inv.safety_stock)
        rows.append(f)
    return pd.DataFrame(rows)
