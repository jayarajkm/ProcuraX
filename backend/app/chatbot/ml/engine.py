import re
from sqlalchemy.orm import Session
from app.chatbot.types import ChatResult
from app.ml import predict as P

RISK_RE = re.compile(r"stock ?out|run out|running out|at risk|replenish|reorder|shortage|low stock", re.I)


def answer(db: Session, message: str, **_) -> ChatResult:
    try:
        if RISK_RE.search(message) and not message.lower().startswith("classify"):
            r = P.stockout_scan(db, limit=10)
            if not r["items"]:
                reply = f"Scanned {r['scanned']} stock records; none have predicted stockout risk >= {r['threshold']}."
            else:
                reply = (f"Scanned {r['scanned']} stock records: {r['flagged']} have predicted stockout risk >= {r['threshold']} within supplier lead time. "
                         f"Top {len(r['items'])} by risk shown, with approximate replenishment quantities.")
            top = r["items"][0]["risk_probability"] if r["items"] else None
            return ChatResult(reply=reply, approach="scikit-learn GradientBoosting stockout-risk classifier + demand forecaster over inventory & demand history",
                              data_sources=["inventory", "demand_history", "supplier_products", "ml_model_registry"],
                              steps=["Built features from last 3 months of demand per product/warehouse", "Predicted P(stockout within lead time) with real current stock",
                                     "Forecast daily demand and applied reorder formula for replenishment"],
                              confidence=top, confidence_kind="model-estimated probability for the highest-risk item (uncalibrated)" if top else None,
                              table={"columns": ["SKU", "Product", "Warehouse", "Risk", "Available", "Pred. demand/day", "Lead (d)", "Suggested qty"],
                                     "rows": [[i["sku"], i["product_name"], i["warehouse"], i["risk_probability"], i["available"], i["predicted_daily_demand"], i["lead_time_days"], i["suggested_replenishment"]] for i in r["items"]]},
                              extra={"models": r["models"]})
        text = re.sub(r"^\s*classify\s*:\s*", "", message, flags=re.I)
        c = P.classify_message(db, text)
        probs = ", ".join(f"{k.replace('_', ' ')} {v:.0%}" for k, v in list(c["probabilities"].items())[:3])
        return ChatResult(reply=f"Predicted category: **{c['label'].replace('_', ' ')}** (confidence {c['confidence']:.0%}). Top probabilities: {probs}.",
                          approach="scikit-learn TF-IDF + logistic regression message classifier", data_sources=["ml_model_registry", "supplier_messages (training)"],
                          steps=["Vectorised text with TF-IDF (1-2 grams)", "Predicted class probabilities"], confidence=c["confidence"],
                          confidence_kind="model class probability", extra={"model": c["model"], "probabilities": c["probabilities"]})
    except P.ModelNotTrained as e:
        return ChatResult(reply=str(e), approach="ML chatbot: model not available", data_sources=["ml_model_registry"])
