from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"  # set to "production" on the server
    docs_enabled: bool = True
    database_url: str = "postgresql+psycopg://procurax:devpassword@postgres:5432/procurax_db"
    jwt_secret: str = "dev-only"
    jwt_expire_minutes: int = 480
    cors_origins: str = "http://localhost:5173"
    upload_dir: str = "/data/uploads"
    model_store_dir: str = "/data/models"
    max_upload_mb: int = 20
    ai_provider: str = "anthropic"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384
    seed: int = 42


@lru_cache
def get_settings() -> Settings:
    return Settings()


WEAK_SECRET_MARKERS = ("change-me", "changeme", "not-for-production", "devpassword", "your-secret")


def assert_production_safe(s: Settings) -> None:
    """Refuse to boot in production with weak/default secrets (called at startup)."""
    if s.environment != "production":
        return
    problems = []
    if len(s.jwt_secret) < 32 or s.jwt_secret.lower().startswith("dev") or any(m in s.jwt_secret.lower() for m in WEAK_SECRET_MARKERS):
        problems.append("JWT_SECRET is weak/default (need >= 32 random chars)")
    if any(m in s.database_url.lower() for m in ("devpassword", "change-me")):
        problems.append("DATABASE_URL uses a default password")
    if "localhost" in s.cors_origins or "*" in s.cors_origins:
        problems.append("CORS_ORIGINS must list only the real https origin(s)")
    if problems:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))
