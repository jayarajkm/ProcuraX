"""Train and evaluate all models.  Run:  python -m app.ml.train

Trains for real on database content, evaluates on a held-out set, persists versioned artefacts and registers metrics.
"""
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix, f1_score, mean_absolute_error,
                             precision_score, r2_score, recall_score, roc_auc_score)
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import make_pipeline
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.ml import features as F
from app.ml.registry import save_model
from app.models import SupplierMessage

SEED = 42
CAVEAT_SYNTH = "Trained on SYNTHETIC data; metrics describe this demo dataset and will not transfer to real data."


def train_message_classifier(db: Session):
    rows = db.execute(select(SupplierMessage.text, SupplierMessage.label)).all()
    X, y = [r[0] for r in rows], [r[1] for r in rows]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)
    pipe = make_pipeline(TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1), LogisticRegression(max_iter=2000, C=5.0))
    cv = cross_val_score(pipe, Xtr, ytr, cv=5, scoring="f1_macro")
    pipe.fit(Xtr, ytr)
    pred = pipe.predict(Xte)
    labels = sorted(set(y))
    metrics = {"task": "supplier message classification", "split": "stratified 80/20 hold-out", "train_rows": len(Xtr), "test_rows": len(Xte),
               "accuracy": round(accuracy_score(yte, pred), 4), "macro_f1": round(f1_score(yte, pred, average="macro"), 4),
               "cv_macro_f1_mean": round(float(cv.mean()), 4), "cv_macro_f1_std": round(float(cv.std()), 4),
               "per_class": {k: {m: round(v, 3) for m, v in d.items()} for k, d in classification_report(yte, pred, output_dict=True, zero_division=0).items() if k in labels},
               "labels": labels, "confusion_matrix": confusion_matrix(yte, pred, labels=labels).tolist(),
               "caveats": [CAVEAT_SYNTH, "Messages are generated from templates, so near-duplicates appear across train/test and scores are optimistic."]}
    return save_model(db, "message_classifier", "TF-IDF(1-2gram) + LogisticRegression", pipe, metrics, len(Xtr))


def train_inventory_models(db: Session):
    df = F.build_training_frame(db, SEED)
    max_w = df["window"].max()
    train, test = df[df["window"] <= max_w - 2], df[df["window"] > max_w - 2]  # time-based split: last 2 windows held out
    meta = {"split": f"time-based: windows <= {max_w - 2} train, last 2 windows test", "train_rows": len(train), "test_rows": len(test),
            "training_stock_source": "SIMULATED (historical stock levels are not stored); inference uses real inventory", "caveats": [CAVEAT_SYNTH]}

    reg = GradientBoostingRegressor(random_state=SEED).fit(train[F.DEMAND_FEATURES], train["target_daily"])
    p = reg.predict(test[F.DEMAND_FEATURES])
    naive_last, naive_mean = test["last_daily"], test["avg_daily"]
    reg_metrics = {**meta, "task": "next-month daily demand forecast", "mae": round(mean_absolute_error(test["target_daily"], p), 3),
                   "r2": round(r2_score(test["target_daily"], p), 4),
                   "baseline_mae_last_month": round(mean_absolute_error(test["target_daily"], naive_last), 3),
                   "baseline_mae_3mo_mean": round(mean_absolute_error(test["target_daily"], naive_mean), 3)}
    reg_row = save_model(db, "demand_forecaster", "GradientBoostingRegressor", reg, reg_metrics, len(train))

    clf = GradientBoostingClassifier(random_state=SEED).fit(train[F.RISK_FEATURES], train["stockout"])
    prob = clf.predict_proba(test[F.RISK_FEATURES])[:, 1]
    pred = (prob >= 0.5).astype(int)
    base = (test["cover_ratio"] < 1.0).astype(int)  # naive rule: stock below mean lead-time demand
    yt = test["stockout"]
    clf_metrics = {**meta, "task": "stockout within supplier lead time (binary)", "positive_rate_test": round(float(yt.mean()), 4),
                   "accuracy": round(accuracy_score(yt, pred), 4), "precision": round(precision_score(yt, pred, zero_division=0), 4),
                   "recall": round(recall_score(yt, pred, zero_division=0), 4), "f1": round(f1_score(yt, pred, zero_division=0), 4),
                   "roc_auc": round(roc_auc_score(yt, prob), 4), "confusion_matrix": confusion_matrix(yt, pred).tolist(),
                   "baseline_naive_cover_rule": {"accuracy": round(accuracy_score(yt, base), 4), "precision": round(precision_score(yt, base, zero_division=0), 4),
                                                 "recall": round(recall_score(yt, base, zero_division=0), 4), "f1": round(f1_score(yt, base, zero_division=0), 4)},
                   "feature_importance": {k: round(float(v), 4) for k, v in sorted(zip(F.RISK_FEATURES, clf.feature_importances_), key=lambda kv: -kv[1])}}
    clf_row = save_model(db, "stockout_risk", "GradientBoostingClassifier", clf, clf_metrics, len(train))
    return reg_row, clf_row


def train_all(db: Session) -> list:
    rows = [train_message_classifier(db), *train_inventory_models(db)]
    db.commit()
    return rows


if __name__ == "__main__":
    with SessionLocal() as db:
        for r in train_all(db):
            print(r.name, r.version, {k: v for k, v in r.metrics.items() if isinstance(v, (int, float))})
