import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.deps import audit, require
from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.database.session import get_db
from app.models import ChatbotMessage, ChatbotSession, ChatbotType, MLModelRegistry, User
from app.services import chat as chat_svc

router = APIRouter(tags=["chatbots"])
IMPLEMENTED = {"rule_based", "nlp", "ml", "generative", "rag", "agentic"}


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: uuid.UUID | None = None
    language: str = Field(default="en", max_length=8)


def _llm_configured() -> bool:
    st = get_settings()
    return bool({"anthropic": st.anthropic_api_key, "groq": st.groq_api_key}.get(st.ai_provider))


def _type_out(t: ChatbotType) -> dict:
    return {"slug": t.slug, "name": t.name, "description": t.description, "technology": t.technology, "use_cases": t.use_cases,
            "example_prompts": t.example_prompts, "requires_llm": t.requires_llm, "available": t.slug in IMPLEMENTED,
            "configured": (not t.requires_llm) or _llm_configured()}


@router.get("/languages")
def languages(_: User = Depends(require("chat:use"))):
    from app.chatbot.i18n import LANGUAGES
    return [{"code": c, "name": n, "native_name": nn, "rtl": rtl} for c, n, nn, rtl in LANGUAGES]


@router.get("/chatbots")
def catalogue(db: Session = Depends(get_db), _: User = Depends(require("chat:use"))):
    order = ["rule_based", "nlp", "ml", "generative", "rag", "agentic"]
    ts = sorted(db.scalars(select(ChatbotType)), key=lambda t: order.index(t.slug))
    return [_type_out(t) for t in ts]


@router.get("/chatbots/{slug}")
def chatbot(slug: str, db: Session = Depends(get_db), _: User = Depends(require("chat:use"))):
    t = db.scalar(select(ChatbotType).where(ChatbotType.slug == slug))
    if not t: raise NotFound("Chatbot")
    return _type_out(t)


@router.post("/chatbots/{slug}/chat")
def chat(slug: str, body: ChatIn, db: Session = Depends(get_db), user: User = Depends(require("chat:use"))):
    out = chat_svc.chat(db, user, slug, body.message, body.session_id, body.language)
    db.commit()
    return out


@router.get("/chatbots/{slug}/sessions")
def sessions(slug: str, db: Session = Depends(get_db), user: User = Depends(require("chat:use"))):
    t = db.scalar(select(ChatbotType).where(ChatbotType.slug == slug))
    if not t: raise NotFound("Chatbot")
    rows = db.scalars(select(ChatbotSession).where(ChatbotSession.user_id == user.id, ChatbotSession.chatbot_type_id == t.id)
                      .order_by(ChatbotSession.created_at.desc()).limit(50))
    return [{"id": s.id, "title": s.title, "created_at": s.created_at} for s in rows]


@router.get("/chat-sessions/{sid}/messages")
def messages(sid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require("chat:use"))):
    s = db.get(ChatbotSession, sid)
    if not s or s.user_id != user.id: raise NotFound("Chat session")
    return [{"id": m.id, "role": m.role, "content": m.content, "metadata": m.meta, "created_at": m.created_at}
            for m in db.scalars(select(ChatbotMessage).where(ChatbotMessage.session_id == sid).order_by(ChatbotMessage.created_at))]


# ---- ML ----
class ClassifyIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _model_out(m: MLModelRegistry) -> dict:
    return {"id": m.id, "name": m.name, "version": m.version, "algorithm": m.algorithm, "training_rows": m.training_rows,
            "trained_at": m.trained_at, "is_active": m.is_active, "metrics": m.metrics}


@router.get("/ml/models")
def ml_models(db: Session = Depends(get_db), _: User = Depends(require("ml:read"))):
    return [_model_out(m) for m in db.scalars(select(MLModelRegistry).order_by(MLModelRegistry.trained_at.desc()))]


@router.post("/ml/train")
def ml_train(db: Session = Depends(get_db), user: User = Depends(require("ml:train"))):
    from app.ml.train import train_all  # lazy: keeps pandas/scikit-learn out of the API process until needed (1 GB servers)
    rows = train_all(db)
    audit(db, user, "ml.train", "ml_model_registry", ",".join(r.version for r in rows)); db.commit()
    return [_model_out(r) for r in rows]


@router.post("/ml/classify")
def ml_classify(body: ClassifyIn, db: Session = Depends(get_db), _: User = Depends(require("ml:read"))):
    from app.ml import predict as P
    try:
        out = P.classify_message(db, body.text)
    except P.ModelNotTrained as e:
        raise AppError("model_not_trained", str(e), 409)
    db.commit()
    return out


@router.get("/ml/stockout-risk")
def ml_stockout(limit: int = 10, threshold: float = 0.5, db: Session = Depends(get_db), _: User = Depends(require("ml:read"))):
    from app.ml import predict as P
    try:
        out = P.stockout_scan(db, limit=min(limit, 100), threshold=threshold)
    except P.ModelNotTrained as e:
        raise AppError("model_not_trained", str(e), 409)
    db.commit()
    return out
