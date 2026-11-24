import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot import i18n
from app.chatbot.generative.provider import ProviderError, ProviderNotConfigured
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


def run_with_language(db: Session, slug: str, message: str, user: User | None, history: list[dict] | None, language: str) -> ChatResult:
    h = _handler(slug)
    if not i18n.is_valid(language):
        raise AppError("invalid_language", f"Unsupported language '{language}'", 422)
    if language == "en":
        return h(db, message, history=history, user=user)
    name = i18n.language_name(language)
    if slug == "agentic":  # the agent reasons in any language; only its user-facing final answer is localised, tool protocol stays English
        res = h(db, message, history=history, user=user, language=language)
        res.language, res.translation = language, {"mode": "llm_native", "note": "Final answer written in the selected language; tool calls, plan and audit logs stay English."}
        return res
    notes: dict = {}
    try:
        english = i18n.translate(message, "English")
        notes["input_translated_to_english"] = english
    except (ProviderNotConfigured, ProviderError) as e:
        english = None
        notes["input_translation_error"] = str(e)[:300]
    q = english or message
    if slug in ("generative", "rag"):  # LLM bots answer natively; the English query only drives fact selection / retrieval
        res = h(db, message, history=history, user=user, language=language, english_query=q)
        notes["mode"] = "llm_native"
        if slug == "rag":
            notes["note"] = "Retrieval uses the English translation of your question (embeddings are English); the answer is written in the selected language. Source excerpts stay in the original document language."
    else:  # rule_based / nlp / ml: deterministic engine in English + LLM translation of the reply
        res = h(db, q, history=history, user=user)
        notes["mode"] = "deterministic_bot_with_llm_translation"
        notes["original_reply"] = res.reply
        notes["not_translated"] = ["table", "approach", "steps", "data_sources"]
        try:
            res.reply = i18n.translate(res.reply, name)
        except (ProviderNotConfigured, ProviderError) as e:
            notes["output_translation_error"] = str(e)[:300]
            res.reply = f"{res.reply}\n\n(Translation to {name} unavailable: {e}. Showing the English answer.)"
    res.language, res.translation = language, notes
    return res


def run_bot(db: Session, slug: str, message: str, user: User | None = None, history: list[dict] | None = None, language: str = "en") -> ChatResult:
    """Stateless dispatch (used by chat and the comparison feature)."""
    return run_with_language(db, slug, message, user, history, language)


def chat(db: Session, user: User, slug: str, message: str, session_id: uuid.UUID | None, language: str = "en") -> dict:
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
    res = run_with_language(db, slug, message, user, prior, language)
    m = ChatbotMessage(session_id=s.id, role="assistant", content=res.reply, meta=res.meta())
    db.add(m); db.flush()
    return {"session_id": s.id, "message_id": m.id, "reply": res.reply, "metadata": m.meta}
