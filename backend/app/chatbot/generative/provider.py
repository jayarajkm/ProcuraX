"""LLM provider abstraction. Swap providers via AI_PROVIDER / ai_provider_configurations; API keys are env-only."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from app.core.config import get_settings


import contextvars
import time as _time

# Wall-clock deadline (epoch seconds) set by callers such as the agent loop; backoff never sleeps past it.
deadline_var: contextvars.ContextVar[float | None] = contextvars.ContextVar("llm_deadline", default=None)


class ProviderNotConfigured(Exception):
    pass


class ProviderError(Exception):
    pass


@dataclass
class LLMResponse:
    text: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMProvider(ABC):
    name: str

    @abstractmethod
    def complete(self, system: str, messages: list[dict], max_tokens: int = 1024, temperature: float = 0.2) -> LLMResponse: ...


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str):
        import anthropic
        self.client, self.model = anthropic.Anthropic(api_key=api_key, timeout=60.0, max_retries=2), model

    def complete(self, system, messages, max_tokens=1024, temperature=0.2) -> LLMResponse:
        import anthropic
        try:
            r = self.client.messages.create(model=self.model, max_tokens=max_tokens, system=system, messages=messages, temperature=temperature)
        except anthropic.APIError as e:  # never leak the key; surface a concise message
            raise ProviderError(f"{type(e).__name__}: {getattr(e, 'message', str(e))[:300]}") from e
        text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
        return LLMResponse(text=text, model=self.model, input_tokens=r.usage.input_tokens, output_tokens=r.usage.output_tokens)


class GroqProvider(LLMProvider):
    """Groq via its OpenAI-compatible chat completions endpoint (works with the free tier, subject to its rate limits)."""
    name = "groq"
    URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str, model: str):
        self.api_key, self.model = api_key, model

    def complete(self, system, messages, max_tokens=1024, temperature=0.2) -> LLMResponse:
        import httpx
        body = {"model": self.model, "max_tokens": max_tokens, "temperature": temperature,
                "messages": [{"role": "system", "content": system}, *messages]}
        if "gpt-oss" in self.model:  # reasoning model: hidden reasoning tokens count toward max_tokens, so keep effort low and add headroom
            body["reasoning_effort"] = "low"
            body["max_tokens"] = max_tokens + 1024
        import re, time
        for attempt in range(3):  # free tier: wait out per-minute limits instead of failing immediately
            try:
                r = httpx.post(self.URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"}, timeout=60.0)
            except httpx.HTTPError as e:
                raise ProviderError(f"Groq request failed: {type(e).__name__}") from e
            if r.status_code != 429 or attempt == 2:
                break
            m = re.search(r"try again in ([\d.]+)s", r.text)
            wait = min(float(m.group(1)) + 0.5 if m else 10.0, 30.0)
            dl = deadline_var.get()
            if dl is not None and _time.time() + wait > dl:
                raise ProviderError("Groq free-tier rate limit hit and the execution deadline would pass before it resets")
            time.sleep(wait)
        if r.status_code != 200:
            try:
                msg = r.json().get("error", {}).get("message", "")
            except ValueError:
                msg = ""
            hint = " (free-tier rate limit; wait and retry)" if r.status_code == 429 else ""
            raise ProviderError(f"Groq HTTP {r.status_code}: {msg[:250]}{hint}")
        d = r.json()
        u = d.get("usage", {})
        import re
        text = re.sub(r"<think>.*?</think>", "", d["choices"][0]["message"].get("content") or "", flags=re.S).strip()
        if not text:
            raise ProviderError(f"Groq model '{self.model}' returned an empty answer (finish_reason={d['choices'][0].get('finish_reason')}); try a different GROQ_MODEL")
        return LLMResponse(text, self.model, u.get("prompt_tokens"), u.get("completion_tokens"))


_override: LLMProvider | None = None  # tests may inject a provider; production code never sets this


def set_provider_override(p: LLMProvider | None):
    global _override
    _override = p


SUPPORTED = ("anthropic", "groq")


def _keys() -> dict:
    s = get_settings()
    return {"anthropic": s.anthropic_api_key, "groq": s.groq_api_key}


def _default_models() -> dict:
    s = get_settings()
    return {"anthropic": s.anthropic_model, "groq": s.groq_model}


def resolve_config() -> tuple[str, str]:
    """Admin-managed default (ai_provider_configurations) wins if its key is configured; otherwise fall back to env (AI_PROVIDER)."""
    s = get_settings()
    try:
        from sqlalchemy import select
        from app.database.session import SessionLocal
        from app.models import AIProviderConfiguration
        with SessionLocal() as db:
            row = db.scalar(select(AIProviderConfiguration).where(AIProviderConfiguration.is_default))
            if row and row.provider in SUPPORTED and _keys().get(row.provider):
                return row.provider, row.model
    except Exception:  # DB unavailable/unmigrated: env fallback
        pass
    return s.ai_provider, _default_models().get(s.ai_provider, "")


def get_provider() -> LLMProvider:
    if _override is not None:
        return _override
    name, model = resolve_config()
    if name not in SUPPORTED:
        raise ProviderNotConfigured(f"No LLM provider is configured: unknown provider '{name}'. Supported: {', '.join(SUPPORTED)}.")
    key = _keys().get(name)
    if not key:
        env = {"anthropic": "ANTHROPIC_API_KEY", "groq": "GROQ_API_KEY"}[name]
        raise ProviderNotConfigured(f"No LLM provider is configured: provider '{name}' selected but {env} is not set in the server environment (.env). "
                                    "Rule-based, NLP and ML chatbots still work without it.")
    return AnthropicProvider(key, model) if name == "anthropic" else GroqProvider(key, model)
