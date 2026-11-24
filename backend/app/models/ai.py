import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database.base import Base, IdMixin, TimestampMixin


class ChatbotType(IdMixin, Base):
    __tablename__ = "chatbot_types"
    slug: Mapped[str] = mapped_column(String(40), unique=True)  # rule_based, nlp, ml, generative, rag, agentic
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    technology: Mapped[str] = mapped_column(Text)
    use_cases: Mapped[list] = mapped_column(JSONB, default=list)
    example_prompts: Mapped[list] = mapped_column(JSONB, default=list)
    requires_llm: Mapped[bool] = mapped_column(Boolean, default=False)


class ChatbotConfiguration(IdMixin, TimestampMixin, Base):
    __tablename__ = "chatbot_configurations"
    chatbot_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chatbot_types.id"), index=True)
    key: Mapped[str] = mapped_column(String(80))
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    __table_args__ = (UniqueConstraint("chatbot_type_id", "key"),)


class ChatbotSession(IdMixin, TimestampMixin, Base):
    __tablename__ = "chatbot_sessions"
    chatbot_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chatbot_types.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="New conversation")


class ChatbotMessage(IdMixin, Base):
    __tablename__ = "chatbot_messages"
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chatbot_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)  # approach, sources, confidence, steps
    # python-side default: server now() is the TRANSACTION start, so a user message and its reply would tie and could sort wrongly
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now(), index=True)


class IntentDefinition(IdMixin, TimestampMixin, Base):
    __tablename__ = "intent_definitions"
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(String(300), default="")
    action: Mapped[str] = mapped_column(String(80))  # routed service action key


class IntentExample(IdMixin, Base):
    __tablename__ = "intent_examples"
    intent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("intent_definitions.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(300))


class RuleDefinition(IdMixin, TimestampMixin, Base):
    __tablename__ = "rule_definitions"
    name: Mapped[str] = mapped_column(String(80), unique=True)
    patterns: Mapped[list] = mapped_column(JSONB)  # keyword/regex list
    response_template: Mapped[str] = mapped_column(Text)  # may contain {placeholders} resolved from DB
    value_source: Mapped[str | None] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class SupplierMessage(IdMixin, Base):
    """Synthetic labelled supplier/procurement messages used to train the ML classifier."""
    __tablename__ = "supplier_messages"
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("suppliers.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(String(40), index=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True)


class MLModelRegistry(IdMixin, TimestampMixin, Base):
    __tablename__ = "ml_model_registry"
    name: Mapped[str] = mapped_column(String(80), index=True)
    version: Mapped[str] = mapped_column(String(40))
    algorithm: Mapped[str] = mapped_column(String(80))
    artifact_path: Mapped[str] = mapped_column(String(300))
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    training_rows: Mapped[int] = mapped_column(Integer)
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("name", "version"),)


class MLPrediction(IdMixin, Base):
    __tablename__ = "ml_predictions"
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ml_model_registry.id"), index=True)
    input_ref: Mapped[str] = mapped_column(String(200))
    output: Mapped[dict] = mapped_column(JSONB)
    confidence: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AIProviderConfiguration(IdMixin, TimestampMixin, Base):
    __tablename__ = "ai_provider_configurations"
    provider: Mapped[str] = mapped_column(String(40), unique=True)
    model: Mapped[str] = mapped_column(String(80))
    api_key_env_var: Mapped[str] = mapped_column(String(80))  # name of env var; key itself never stored
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)


class PromptTemplate(IdMixin, TimestampMixin, Base):
    __tablename__ = "prompt_templates"
    name: Mapped[str] = mapped_column(String(80), unique=True)
    template: Mapped[str] = mapped_column(Text)
    variables: Mapped[list] = mapped_column(JSONB, default=list)
