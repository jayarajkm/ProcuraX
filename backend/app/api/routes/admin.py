from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.deps import audit, require
from app.chatbot.generative.provider import SUPPORTED, _keys
from app.core.errors import AppError, NotFound
from app.database.session import get_db
from app.models import (AIProviderConfiguration, AgentDefinition, AgentToolRegistry, AuditLog, ChatbotConfiguration, ChatbotType,
                        IntentDefinition, IntentExample, PromptTemplate, RuleDefinition, User)
from app.repositories.base import paginate

router = APIRouter(prefix="/admin", tags=["admin"])
ADMIN = require("admin:manage")
ENV = {"anthropic": "ANTHROPIC_API_KEY", "groq": "GROQ_API_KEY"}
DEFAULT_MODELS = {"anthropic": "claude-sonnet-5-5", "groq": "qwen/qwen3.8-27b"}


def ensure_provider_rows(db: Session):
    have = {r.provider: r for r in db.scalars(select(AIProviderConfiguration))}
    from app.core.config import get_settings
    s = get_settings()
    for p in SUPPORTED:
        if p not in have:
            m = {"anthropic": s.anthropic_model, "groq": s.groq_model}[p]
            db.add(AIProviderConfiguration(provider=p, model=m, api_key_env_var=ENV[p], is_default=False))
    db.flush()
    if not db.scalar(select(AIProviderConfiguration).where(AIProviderConfiguration.is_default)):
        row = db.scalar(select(AIProviderConfiguration).where(AIProviderConfiguration.provider == s.ai_provider))
        if row: row.is_default = True
    db.flush()


class ProviderPatch(BaseModel):
    model: str | None = Field(default=None, min_length=1, max_length=80)
    is_default: bool | None = None


@router.get("/providers")
def providers(db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    ensure_provider_rows(db); db.commit()
    keys = _keys()
    return [{"provider": r.provider, "model": r.model, "is_default": r.is_default, "api_key_env_var": r.api_key_env_var, "key_configured": bool(keys.get(r.provider))}
            for r in db.scalars(select(AIProviderConfiguration).order_by(AIProviderConfiguration.provider))]


@router.patch("/providers/{provider}")
def patch_provider(provider: str, body: ProviderPatch, db: Session = Depends(get_db), user: User = Depends(ADMIN)):
    ensure_provider_rows(db)
    r = db.scalar(select(AIProviderConfiguration).where(AIProviderConfiguration.provider == provider))
    if not r: raise NotFound("Provider")
    if body.model: r.model = body.model
    if body.is_default:
        if not _keys().get(provider):
            raise AppError("key_missing", f"{ENV[provider]} is not set on the server, so '{provider}' cannot be the default", 409)
        for o in db.scalars(select(AIProviderConfiguration)): o.is_default = (o.provider == provider)
    audit(db, user, "admin.provider.update", "ai_provider", provider, model=body.model, is_default=body.is_default); db.commit()
    return {"provider": r.provider, "model": r.model, "is_default": r.is_default}


class PromptPatch(BaseModel):
    template: str = Field(min_length=10, max_length=8000)


@router.get("/prompts")
def prompts(db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    return [{"name": p.name, "template": p.template, "variables": p.variables, "updated_at": p.updated_at} for p in db.scalars(select(PromptTemplate).order_by(PromptTemplate.name))]


@router.patch("/prompts/{name}")
def patch_prompt(name: str, body: PromptPatch, db: Session = Depends(get_db), user: User = Depends(ADMIN)):
    p = db.scalar(select(PromptTemplate).where(PromptTemplate.name == name))
    if not p: raise NotFound("Prompt")
    p.template = body.template; audit(db, user, "admin.prompt.update", "prompt_template", name); db.commit()
    return {"name": p.name, "template": p.template}


class ToolPatch(BaseModel):
    is_enabled: bool


@router.get("/tools")
def tools(db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    from app.tools.registry import sync_registry
    sync_registry(db); db.commit()
    return [{"name": t.name, "description": t.description, "required_permission": t.required_permission, "is_sensitive": t.is_sensitive, "is_enabled": t.is_enabled}
            for t in db.scalars(select(AgentToolRegistry).order_by(AgentToolRegistry.name))]


@router.patch("/tools/{name}")
def patch_tool(name: str, body: ToolPatch, db: Session = Depends(get_db), user: User = Depends(ADMIN)):
    t = db.scalar(select(AgentToolRegistry).where(AgentToolRegistry.name == name))
    if not t: raise NotFound("Tool")
    t.is_enabled = body.is_enabled; audit(db, user, "admin.tool.update", "agent_tool", name, enabled=body.is_enabled); db.commit()
    return {"name": t.name, "is_enabled": t.is_enabled}


class AgentLimits(BaseModel):
    max_iterations: int | None = Field(default=None, ge=1, le=30)
    timeout_seconds: int | None = Field(default=None, ge=10, le=900)


@router.get("/agent")
def agent_limits(db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    a = db.scalar(select(AgentDefinition))
    return {"name": a.name, "max_iterations": a.max_iterations, "timeout_seconds": a.timeout_seconds}


@router.patch("/agent")
def patch_agent(body: AgentLimits, db: Session = Depends(get_db), user: User = Depends(ADMIN)):
    a = db.scalar(select(AgentDefinition))
    for k, v in body.model_dump(exclude_none=True).items(): setattr(a, k, v)
    audit(db, user, "admin.agent.update", "agent_definition", a.name, **body.model_dump(exclude_none=True)); db.commit()
    return {"max_iterations": a.max_iterations, "timeout_seconds": a.timeout_seconds}


class RulePatch(BaseModel):
    patterns: list[str] | None = Field(default=None, min_length=1)
    response_template: str | None = Field(default=None, min_length=1, max_length=1000)
    is_active: bool | None = None


@router.get("/rules")
def rules(db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    return [{"name": r.name, "patterns": r.patterns, "response_template": r.response_template, "value_source": r.value_source, "is_active": r.is_active}
            for r in db.scalars(select(RuleDefinition).order_by(RuleDefinition.name))]


@router.patch("/rules/{name}")
def patch_rule(name: str, body: RulePatch, db: Session = Depends(get_db), user: User = Depends(ADMIN)):
    r = db.scalar(select(RuleDefinition).where(RuleDefinition.name == name))
    if not r: raise NotFound("Rule")
    if body.response_template is not None:
        try:  # reject templates referencing placeholders the resolver cannot supply
            from app.chatbot.rule_based.engine import resolve_values
            vals, _ = resolve_values(db, r.value_source)
            body.response_template.format(**vals)
        except (KeyError, IndexError, ValueError) as e:
            raise AppError("invalid_template", f"Template placeholder problem: {e}", 422)
    for k, v in body.model_dump(exclude_none=True).items(): setattr(r, k, v)
    audit(db, user, "admin.rule.update", "rule", name); db.commit()
    return {"name": r.name, "patterns": r.patterns, "response_template": r.response_template, "is_active": r.is_active}


class PolicyPatch(BaseModel):
    value: str = Field(min_length=1, max_length=200)


@router.get("/policy")
def policy(db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    rows = db.execute(select(ChatbotConfiguration).join(ChatbotType).where(ChatbotType.slug == "rule_based").order_by(ChatbotConfiguration.key)).scalars()
    return [{"key": c.key, "value": c.value.get("value")} for c in rows]


@router.patch("/policy/{key}")
def patch_policy(key: str, body: PolicyPatch, db: Session = Depends(get_db), user: User = Depends(ADMIN)):
    c = db.scalar(select(ChatbotConfiguration).join(ChatbotType).where(ChatbotType.slug == "rule_based", ChatbotConfiguration.key == key))
    if not c: raise NotFound("Policy value")
    if key in ("approval_threshold", "review_days", "default_tax_rate"):
        try: float(body.value)
        except ValueError: raise AppError("invalid_value", f"'{key}' must be numeric", 422)
    c.value = {"value": body.value}; audit(db, user, "admin.policy.update", "policy", key, value=body.value); db.commit()
    return {"key": key, "value": body.value}


@router.get("/intents")
def intents(db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    out = []
    for i in db.scalars(select(IntentDefinition).order_by(IntentDefinition.name)):
        ex = [e.text for e in db.scalars(select(IntentExample).where(IntentExample.intent_id == i.id))]
        out.append({"name": i.name, "action": i.action, "examples": ex})
    return out


@router.get("/audit")
def audit_log(action: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: Session = Depends(get_db), _: User = Depends(ADMIN)):
    stmt = select(AuditLog)
    if action: stmt = stmt.where(AuditLog.action.ilike(f"%{action}%"))
    r = paginate(db, stmt, page, page_size, default_sort=AuditLog.created_at, order="desc")
    emails = {u.id: u.email for u in db.scalars(select(User))}
    r["items"] = [{"id": a.id, "at": a.created_at, "user": emails.get(a.user_id), "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id, "details": a.details} for a in r["items"]]
    return r
