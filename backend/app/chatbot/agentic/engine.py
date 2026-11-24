from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot.agentic import executor
from app.chatbot.types import ChatResult
from app.models import AgentApproval, AgentExecutionStep


def describe(db: Session, ex) -> ChatResult:
    steps = list(db.scalars(select(AgentExecutionStep).where(AgentExecutionStep.execution_id == ex.id).order_by(AgentExecutionStep.step_index)))
    pending = db.scalar(select(AgentApproval).where(AgentApproval.execution_id == ex.id, AgentApproval.status == "pending"))
    executed = any(s.tool_name in ("create_purchase_request", "submit_purchase_request") and s.status == "ok" for s in steps)
    if ex.status == "awaiting_approval":
        reply = f"I prepared an action that needs human approval before it runs:\n{pending.action_summary}\nApprove or reject it in the Agent Workspace (execution {ex.id})."
    elif ex.status == "completed":
        reply = ex.final_result
    else:
        reply = f"Execution {ex.status}: {ex.error or ex.final_result}"
    return ChatResult(reply=reply, approach="LLM planner + validated tool registry + human approval gate", data_sources=sorted({s.tool_name for s in steps}),
                      steps=[f"Plan: {p}" for p in ex.plan] + [f"{s.step_index + 1}. {s.tool_name} -> {s.status}" for s in steps],
                      action_executed=executed, extra={"execution_id": str(ex.id), "execution_status": ex.status,
                                                        "approval_id": str(pending.id) if pending else None})


def answer(db: Session, message: str, user=None, **_) -> ChatResult:
    ex = executor.start(db, user, message)
    return describe(db, ex)
