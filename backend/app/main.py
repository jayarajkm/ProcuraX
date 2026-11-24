from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy.orm import Session
from app.api.routes import admin, agent, analytics, auth, catalogue, chatbots, documents, operations
from app.core.config import assert_production_safe, get_settings
from app.core.errors import install_handlers
from app.core.ratelimit import limiter
from app.database.health import check_database
from app.database.session import get_db

assert_production_safe(get_settings())
_docs = get_settings().docs_enabled
from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(_):
    try:  # idempotently add reference data introduced after the first seed (intents/rules/providers)
        from app.api.routes.admin import ensure_provider_rows
        from app.database.seeding.reference import sync_reference
        from app.database.session import SessionLocal
        with SessionLocal() as db:
            sync_reference(db); ensure_provider_rows(db); db.commit()
    except Exception as e:  # never block startup on this
        import logging; logging.getLogger("startup").warning("reference sync skipped: %s", e)
    yield


app = FastAPI(lifespan=lifespan, title="ProcuraX AI", version="0.1.0", description="Procurement intelligence platform (synthetic demo data).",
              docs_url="/docs" if _docs else None, redoc_url=None, openapi_url="/openapi.json" if _docs else None)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])
install_handlers(app)

for r in (auth.router, catalogue.router, operations.router, chatbots.router, documents.router, agent.router, analytics.router, admin.router):
    app.include_router(r, prefix="/api/v1")


@app.get("/health", tags=["health"])
def health(db: Session = Depends(get_db)):
    return check_database(db)
