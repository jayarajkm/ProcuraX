import time
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from app.api.deps import audit, require
from app.core.errors import AppError
from app.database.session import get_db
from app.models import User
from app.services import chat as chat_svc
from app.services import insights as ins

router = APIRouter(tags=["analytics"])
BOTS = ["rule_based", "nlp", "ml", "generative", "rag", "agentic"]


class CompareIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", max_length=8)


@router.post("/compare/{slug}")
def compare_one(slug: str, body: CompareIn, db: Session = Depends(get_db), user: User = Depends(require("chat:use"))):
    """Stateless single-bot run for the comparison page (the UI calls the six bots in parallel). Only the agent persists (its execution history)."""
    if slug not in BOTS:
        raise AppError("not_found", "Unknown chatbot", 404)
    if slug == "agentic" and "agent:run" not in {p.code for r in user.roles for p in r.permissions}:
        return {"slug": slug, "status": "forbidden", "message": "Your role cannot run the agent.", "duration_ms": 0}
    t = time.perf_counter()
    try:
        res = chat_svc.run_bot(db, slug, body.message, user=user, language=body.language)
        status = res.status
    except Exception as e:  # one bot failing must never break the comparison
        db.rollback()
        return {"slug": slug, "status": "error", "message": f"{type(e).__name__}: {str(e)[:200]}", "duration_ms": int((time.perf_counter() - t) * 1000)}
    if slug == "agentic":
        db.commit()
    else:
        db.rollback()
    return {"slug": slug, "status": status, "duration_ms": int((time.perf_counter() - t) * 1000), "reply": res.reply, **res.meta()}


@router.get("/dashboard/insights")
def insights(narrative: bool = False, db: Session = Depends(get_db), _: User = Depends(require("product:read"))):
    items = ins.computed(db)
    return {"generated_from": "database (deterministic rules)", "items": items, "narrative": ins.narrative(db, items) if narrative else None}


@router.get("/analytics/ai")
def ai_analytics(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db), _: User = Depends(require("ml:read"))):
    q = lambda sql, **p: [dict(r) for r in db.execute(text(sql), p).mappings()]
    return {
        "window_days": days,
        "messages_by_bot": q("""select t.slug, t.name, count(distinct s.id) sessions, count(m.id) filter (where m.role='user') questions
            from chatbot_types t left join chatbot_sessions s on s.chatbot_type_id=t.id
            left join chatbot_messages m on m.session_id=s.id and m.created_at > now() - make_interval(days => :d) group by t.slug,t.name order by t.slug""", d=days),
        "questions_per_day": q("select to_char(date_trunc('day', created_at),'YYYY-MM-DD') as day, count(*) n from chatbot_messages where role='user' and created_at > now() - make_interval(days => :d) group by 1 order by 1", d=days),
        "agent_executions_by_status": q("select status, count(*) n from agent_executions where created_at > now() - make_interval(days => :d) group by 1 order by 2 desc", d=days),
        "tool_usage": q("select tool_name, count(*) calls, count(*) filter (where status='error') errors, count(*) filter (where status='awaiting_approval') awaiting from agent_execution_steps group by 1 order by 2 desc"),
        "approvals": q("select status, count(*) n, round(avg(extract(epoch from (decided_at-created_at)))::numeric,1) avg_seconds_to_decide from agent_approvals group by 1"),
        "ml_predictions_by_model": q("select r.name, r.version, count(p.id) predictions, round(avg(p.confidence)::numeric,3) avg_confidence from ml_model_registry r left join ml_predictions p on p.model_id=r.id group by 1,2 order by 1,2"),
        "documents_by_status": q("select status, count(*) n from documents group by 1"),
        "note": "Counts come from persisted history tables; empty until the bots have been used.",
    }
