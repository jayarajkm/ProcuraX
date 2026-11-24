from dataclasses import dataclass, field
from typing import Any


@dataclass
class ChatResult:
    """Uniform bot response. Fields a bot cannot meaningfully produce stay None (no invented confidence)."""
    reply: str
    approach: str                       # human-readable processing approach
    data_sources: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    confidence: float | None = None     # only when the technique really yields one
    confidence_kind: str | None = None  # what the confidence means
    retrieval: list[dict] | None = None
    action_executed: bool = False
    language: str | None = None          # selected response language (None = English/default)
    translation: dict | None = None      # how translation was applied (disclosed to the user)
    status: str = "ok"                  # ok | not_configured | provider_error (explicit, so callers never parse reply text)
    table: dict | None = None           # {"columns": [...], "rows": [[...]]}
    extra: dict[str, Any] = field(default_factory=dict)

    def meta(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k not in ("reply", "status") and v not in (None, [], {})}
        d["action_executed"] = self.action_executed
        return d
