import math
from sqlalchemy.orm import Session
from app.ml import features as F
from app.ml.registry import load_active
from app.models import MLPrediction
from app.services import inventory as inv_svc


class ModelNotTrained(Exception):
    pass


def _need(db, name):
    m, row = load_active(db, name)
    if m is None:
        raise ModelNotTrained(f"Model '{name}' has not been trained yet. Run `python -m app.ml.train` or POST /api/v1/ml/train.")
    return m, row


def classify_message(db: Session, text: str) -> dict:
    model, row = _need(db, "message_classifier")
    proba = model.predict_proba([text])[0]
    classes = list(model.classes_)
    ranked = sorted(zip(classes, proba), key=lambda kv: -kv[1])
    out = {"label": ranked[0][0], "confidence": round(float(ranked[0][1]), 4), "probabilities": {k: round(float(v), 4) for k, v in ranked},
           "model": f"{row.name}:{row.version}"}
    db.add(MLPrediction(model_id=row.id, input_ref=text[:200], output=out, confidence=out["confidence"]))
    return out


def stockout_scan(db: Session, limit: int = 10, threshold: float = 0.5) -> dict:
    clf, crow = _need(db, "stockout_risk")
    reg, rrow = _need(db, "demand_forecaster")
    df = F.inference_frame(db)
    df["risk"] = clf.predict_proba(df[F.RISK_FEATURES])[:, 1]
    df["pred_daily"] = reg.predict(df[F.DEMAND_FEATURES]).clip(min=0)
    flagged = df[df["risk"] >= threshold].sort_values("risk", ascending=False)
    review = inv_svc.review_days(db)
    items = []
    for r in flagged.head(limit).itertuples():
        qty = inv_svc.reorder_quantity(r.pred_daily, int(r.lead_time), int(r.safety_stock), int(r.projected), review)
        items.append({"sku": r.sku, "product_name": r.product_name, "warehouse": r.warehouse, "risk_probability": round(float(r.risk), 3),
                      "available": int(r.available), "projected": int(r.projected), "predicted_daily_demand": round(float(r.pred_daily), 2),
                      "lead_time_days": int(r.lead_time), "suggested_replenishment": qty})
        db.add(MLPrediction(model_id=crow.id, input_ref=f"{r.sku}@{r.warehouse}", output=items[-1], confidence=float(r.risk)))
    return {"scanned": int(len(df)), "flagged": int(len(flagged)), "threshold": threshold, "items": items,
            "models": [f"{crow.name}:{crow.version}", f"{rrow.name}:{rrow.version}"]}
