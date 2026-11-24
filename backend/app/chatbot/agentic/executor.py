"""Agent execution: plan -> bounded tool loop -> human approval gate. Fully persisted and resumable."""
import json
import re
import time
import uuid
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.chatbot.generative.provider import ProviderError, ProviderNotConfigured, deadline_var, get_provider
from app.core.errors import AppError, NotFound
from app.models import (AgentApproval, AgentDefinition, AgentExecution, AgentExecutionLog, AgentExecutionStep, PromptTemplate, User)
from app.tools import registry as T

MAX_OBS_CHARS = 1800  # keep prompts small (free-tier token limits)
MAX_CONSECUTIVE_ERRORS = 3

PROTOCOL = """You operate a procurement system ONLY through the tools below. Respond with ONE JSON object and nothing else.
Step format:   {"thought": "<brief reasoning>", "action": {"tool": "<tool name>", "args": { ... }}}
Finish format: {"final": "<concise answer for the user summarising what was found and prepared>"}
Rules: use ids returned by earlier tools (never invent ids); sensitive tools pause for human approval; you can never approve anything yourself;
batch all lines for one purchase request into a single create_purchase_request call; stop as soon as the task is done.
TOOLS:
"""


def _log(db, ex, msg, level="info"):
    db.add(AgentExecutionLog(execution_id=ex.id, level=level, message=msg[:2000]))


def _json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m: raise ValueError("no JSON object found")
    return json.loads(m.group(0))


def _system(db) -> str:
    base = db.scalar(select(PromptTemplate.template).where(PromptTemplate.name == "agent_planner")) or ""
    return base + "\n\n" + PROTOCOL + "\n".join(_compact(s) for s in T.specs())


def _compact(spec: dict) -> str:
    """One line per tool: name(arg:type, optional?) - description. Far fewer tokens than the full JSON schema."""
    sch = spec["input_schema"]; req = set(sch.get("required", []))
    args = ", ".join(f"{k}:{'uuid' if v.get('format') == 'uuid' else v.get('type', 'any')}{'' if k in req else '?'}" for k, v in sch.get("properties", {}).items())
    return f"- {spec['name']}({args}){' [SENSITIVE]' if spec['sensitive'] else ''}: {spec['description']}"


def _messages(ex: AgentExecution, steps: list[AgentExecutionStep]) -> list[dict]:
    msgs = [{"role": "user", "content": f"TASK: {ex.user_request}\nPLAN: {json.dumps(ex.plan)}"}]
    for s in steps:
        msgs.append({"role": "assistant", "content": json.dumps({"action": {"tool": s.tool_name, "args": s.tool_input}})})
        obs = s.tool_output if s.status == "ok" else {"error": s.error or s.status}
        msgs.append({"role": "user", "content": "OBSERVATION: " + json.dumps(obs, default=str)[:MAX_OBS_CHARS]})
    return msgs


def _fail(db, ex, status, msg):
    ex.status, ex.error, ex.finished_at = status, msg, datetime.now(timezone.utc)
    _log(db, ex, msg, "error"); db.flush()


def start(db: Session, user: User, request: str) -> AgentExecution:
    agent = db.scalar(select(AgentDefinition).where(AgentDefinition.name == "procurement_agent"))
    ex = AgentExecution(agent_id=agent.id, user_id=user.id, user_request=request, status="running")
    db.add(ex); db.flush()
    T.sync_registry(db)
    _log(db, ex, f"Execution started by {user.email}")
    try:
        provider = get_provider()
    except ProviderNotConfigured as e:
        _fail(db, ex, "failed", str(e)); return ex
    try:  # planning
        r = provider.complete(_system(db) + '\nFirst, produce ONLY a plan: {"plan": ["step 1", "step 2", ...]} (max 8 short steps).', [{"role": "user", "content": request}], max_tokens=500)
        plan = _json(r.text).get("plan", [])
        ex.plan = [str(p)[:200] for p in plan][:8]
    except (ProviderError, ValueError, json.JSONDecodeError) as e:
        _fail(db, ex, "failed", f"Planning failed: {e}"); return ex
    _log(db, ex, f"Plan created with {len(ex.plan)} step(s)")
    db.flush()
    return run_loop(db, ex, user)


def run_loop(db: Session, ex: AgentExecution, user: User) -> AgentExecution:
    agent = db.get(AgentDefinition, ex.agent_id)
    provider = get_provider()
    started = time.time()
    deadline_var.set(started + agent.timeout_seconds)
    # timeout applies per run of the loop, so a run resumed after a (slow) human approval is not penalised
    ex.status = "running"
    consecutive_errors = 0
    while True:
        steps = list(db.scalars(select(AgentExecutionStep).where(AgentExecutionStep.execution_id == ex.id).order_by(AgentExecutionStep.step_index)))
        if len(steps) >= agent.max_iterations:
            _fail(db, ex, "failed", f"Stopped: reached the maximum of {agent.max_iterations} tool iterations"); return ex
        if time.time() - started > agent.timeout_seconds:
            _fail(db, ex, "timed_out", f"Stopped: exceeded the {agent.timeout_seconds}s execution timeout"); return ex
        try:
            r = provider.complete(_system(db), _messages(ex, steps), max_tokens=800)
            d = _json(r.text)
        except (ProviderError, ValueError, json.JSONDecodeError) as e:
            consecutive_errors += 1
            _log(db, ex, f"Model response unusable: {e}", "warning")
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                _fail(db, ex, "failed", f"Stopped after {MAX_CONSECUTIVE_ERRORS} unusable model responses: {e}"); return ex
            continue
        if "final" in d:
            ex.status, ex.final_result, ex.finished_at = "completed", str(d["final"]), datetime.now(timezone.utc)
            _log(db, ex, "Execution completed"); db.flush(); return ex
        act = d.get("action") or {}
        name, raw = act.get("tool", ""), act.get("args", {})
        step = AgentExecutionStep(execution_id=ex.id, step_index=len(steps), tool_name=str(name)[:80], tool_input=raw if isinstance(raw, dict) else {})
        db.add(step)
        try:
            tool, args = T.validate_call(db, user, str(name), raw if isinstance(raw, dict) else {})
        except T.ToolError as e:
            step.status, step.error = "error", str(e); _log(db, ex, f"{name}: {e}", "warning"); db.flush()
            consecutive_errors += 1
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                _fail(db, ex, "failed", f"Stopped after {MAX_CONSECUTIVE_ERRORS} consecutive tool errors"); return ex
            continue
        if tool.sensitive:  # ---- approval gate: nothing consequential runs without a human
            step.status, step.tool_input = "awaiting_approval", args.model_dump(mode="json")
            db.flush()
            db.add(AgentApproval(execution_id=ex.id, step_id=step.id, status="pending",
                                 action_summary=f"{tool.name}: {json.dumps(step.tool_input, default=str)[:1500]}"))
            ex.status = "awaiting_approval"
            _log(db, ex, f"Paused: '{tool.name}' requires human approval"); db.flush(); return ex
        try:
            step.tool_output = T.execute(db, user, tool, args, ex.id); step.status = "ok"; consecutive_errors = 0
            _log(db, ex, f"{tool.name} ok")
        except T.ToolError as e:
            step.status, step.error = "error", str(e); consecutive_errors += 1; _log(db, ex, f"{tool.name}: {e}", "warning")
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                _fail(db, ex, "failed", f"Stopped after {MAX_CONSECUTIVE_ERRORS} consecutive tool errors"); return ex
        db.flush()


def decide(db: Session, approver: User, approval_id: uuid.UUID, approve: bool, comment: str = "") -> AgentExecution:
    ap = db.get(AgentApproval, approval_id)
    if not ap: raise NotFound("Approval")
    if ap.status != "pending": raise AppError("already_decided", f"Approval already {ap.status}", 409)
    ex = db.get(AgentExecution, ap.execution_id)
    step = db.get(AgentExecutionStep, ap.step_id)
    ap.decided_by, ap.decided_at, ap.comment = approver.id, datetime.now(timezone.utc), comment[:500]
    if not approve:
        ap.status, step.status, step.error = "rejected", "skipped", "Rejected by a human approver"
        ex.status, ex.finished_at = "rejected", datetime.now(timezone.utc)
        ex.final_result = f"Action '{step.tool_name}' was rejected by {approver.email}; nothing was changed."
        _log(db, ex, f"Rejected by {approver.email}"); db.flush(); return ex
    ap.status = "approved"
    requester = db.get(User, ex.user_id)
    _log(db, ex, f"Approved by {approver.email}")
    try:
        tool, args = T.validate_call(db, requester, step.tool_name, step.tool_input)  # re-validate and re-check the requester's permission at execution time
        step.tool_output = T.execute(db, requester, tool, args, ex.id); step.status = "ok"
    except T.ToolError as e:
        step.status, step.error = "error", str(e); _log(db, ex, f"Approved action failed: {e}", "error")
    db.flush()
    return run_loop(db, ex, requester)
