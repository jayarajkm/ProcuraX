import os
from datetime import datetime, timezone
import joblib
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.models import MLModelRegistry

_loaded: dict = {}


def save_model(db: Session, name: str, algorithm: str, obj, metrics: dict, training_rows: int) -> MLModelRegistry:
    version = "v" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    d = os.path.join(get_settings().model_store_dir, name)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{version}.joblib")
    joblib.dump(obj, path)
    db.execute(update(MLModelRegistry).where(MLModelRegistry.name == name).values(is_active=False))
    row = MLModelRegistry(name=name, version=version, algorithm=algorithm, artifact_path=path, metrics=metrics,
                          training_rows=training_rows, is_active=True)
    db.add(row); db.flush()
    return row


def load_active(db: Session, name: str):
    row = db.scalar(select(MLModelRegistry).where(MLModelRegistry.name == name, MLModelRegistry.is_active))
    if not row:
        return None, None
    if _loaded.get(name, (None,))[0] != row.id:
        _loaded[name] = (row.id, joblib.load(row.artifact_path))
    return _loaded[name][1], row
