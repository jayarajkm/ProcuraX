import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot.types import ChatResult
from app.core.errors import AppError, NotFound
from app.models import ChatbotMessage, ChatbotSession, ChatbotType, User


def _handler(slug: str):
    if slug == "rule_based":
        from app.chatbot.rule_based.engine import answer
    elif slug == "nlp":
        from app.chatbot.nlp.engine import answer
    elif slug == "ml":
        from app.chatbot.ml.engine import answer
    elif slug == "generative":
        from app.chatbot.generative.engine import answer
    elif slug == "rag":
        from app.chatbot.rag.engine import answer
    elif slug == "agentic":
        from app.chatbot.agentic.engine import answer
    else:
        raise AppError("not_implemented", f"The '{slug}' chatbot is not available yet in this build.", 501)
    return answer


def run_bot(db: Session, slug: str, message: str, user: User | None = None, history: list[dict] | None = None) -> ChatResult:
    """Stateless dispatch (used by chat and the comparison feature)."""
    return _handler(slug)(db, message, history=history, user=user)


def chat(db: Session, user: User, slug: str, message: str, session_id: uuid.UUID | None) -> dict:
    t = db.scalar(select(ChatbotType).where(ChatbotType.slug == slug))
    if not t:
        raise NotFound("Chatbot")
    handler = _handler(slug)
    if session_id:
        s = db.get(ChatbotSession, session_id)
        if not s or s.user_id != user.id or s.chatbot_type_id != t.id:
            raise NotFound("Chat session")
    else:
        s = ChatbotSession(chatbot_type_id=t.id, user_id=user.id, title=message[:80])
        db.add(s); db.flush()
    prior = [{"role": m.role, "content": m.content} for m in db.scalars(
        select(ChatbotMessage).where(ChatbotMessage.session_id == s.id).order_by(ChatbotMessage.created_at))]
    db.add(ChatbotMessage(session_id=s.id, role="user", content=message))
    db.flush()
    res = handler(db, message, history=prior, user=user)
    m = ChatbotMessage(session_id=s.id, role="assistant", content=res.reply, meta=res.meta())
    db.add(m); db.flush()
    return {"session_id": s.id, "message_id": m.id, "reply": res.reply, "metadata": m.meta}
