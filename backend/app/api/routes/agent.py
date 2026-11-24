import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.deps import audit, require, user_permissions
from app.chatbot.agentic import executor
from app.core.errors import AppError, NotFound
from app.database.session import get_db
from app.models import (AgentApproval, AgentExecution, AgentExecutionLog, AgentExecutionStep, User)
from app.tools import registry as T

router = APIRouter(prefix="/agent", tags=["agent"])


class RunIn(BaseModel):
    request: str = Field(min_length=3, max_length=2000)


class DecisionIn(BaseModel):
    approve: bool; comment: str = ""


def _detail(db: Session, ex: AgentExecution) -> dict:
    steps = db.scalars(select(AgentExecutionStep).where(AgentExecutionStep.execution_id == ex.id).order_by(AgentExecutionStep.step_index))
    aps = db.scalars(select(AgentApproval).where(AgentApproval.execution_id == ex.id).order_by(AgentApproval.created_at))
    logs = db.scalars(select(AgentExecutionLog).where(AgentExecutionLog.execution_id == ex.id).order_by(AgentExecutionLog.created_at))
    return {"id": ex.id, "user_request": ex.user_request, "status": ex.status, "plan": ex.plan, "final_result": ex.final_result, "error": ex.error,
            "created_at": ex.created_at, "finished_at": ex.finished_at,
            "steps": [{"index": s.step_index, "tool": s.tool_name, "input": s.tool_input, "output": s.tool_output, "status": s.status, "error": s.error} for s in steps],
            "approvals": [{"id": a.id, "summary": a.action_summary, "status": a.status, "comment": a.comment, "decided_by": a.decided_by, "decided_at": a.decided_at} for a in aps],
            "logs": [{"level": l.level, "message": l.message, "at": l.created_at} for l in logs]}


def _visible(db, user, eid) -> AgentExecution:
    ex = db.get(AgentExecution, eid)
    if not ex or (ex.user_id != user.id and "agent:approve" not in user_permissions(user)):
        raise NotFound("Execution")
    return ex


@router.get("/tools")
def tools(db: Session = Depends(get_db), _: User = Depends(require("agent:run"))):
    return T.specs()


@router.post("/executions", status_code=201)
def run(body: RunIn, db: Session = Depends(get_db), user: User = Depends(require("agent:run"))):
    ex = executor.start(db, user, body.request)
    audit(db, user, "agent.run", "agent_execution", ex.id, status=ex.status); db.commit()
    return _detail(db, ex)


@router.get("/executions")
def list_executions(db: Session = Depends(get_db), user: User = Depends(require("agent:run"))):
    stmt = select(AgentExecution).order_by(AgentExecution.created_at.desc()).limit(50)
    if "agent:approve" not in user_permissions(user):
        stmt = stmt.where(AgentExecution.user_id == user.id)
    return [{"id": e.id, "user_request": e.user_request, "status": e.status, "created_at": e.created_at} for e in db.scalars(stmt)]


@router.get("/executions/{eid}")
def get_execution(eid: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require("agent:run"))):
    return _detail(db, _visible(db, user, eid))


@router.get("/approvals")
def pending_approvals(db: Session = Depends(get_db), _: User = Depends(require("agent:approve"))):
    return [{"id": a.id, "execution_id": a.execution_id, "summary": a.action_summary, "created_at": a.created_at}
            for a in db.scalars(select(AgentApproval).where(AgentApproval.status == "pending").order_by(AgentApproval.created_at))]


@router.post("/approvals/{aid}/decision")
def decide(aid: uuid.UUID, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(require("agent:approve"))):
    ex = executor.decide(db, user, aid, body.approve, body.comment)
    audit(db, user, "agent.approve" if body.approve else "agent.reject", "agent_approval", aid); db.commit()
    return _detail(db, ex)
