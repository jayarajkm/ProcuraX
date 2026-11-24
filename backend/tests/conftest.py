import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.core.ratelimit import limiter
from app.database.session import SessionLocal, engine, get_db
from app.main import app

limiter.enabled = False


@pytest.fixture(scope="session")
def db():
    with SessionLocal() as s:
        yield s


@pytest.fixture()
def tx_db():
    """Session inside an outer transaction that is rolled back after each test (seed data stays pristine)."""
    conn = engine.connect()
    trans = conn.begin()
    s = Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
    yield s
    s.close(); trans.rollback(); conn.close()


@pytest.fixture()
def client(tx_db):
    app.dependency_overrides[get_db] = lambda: tx_db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def auth(client):
    def _login(role="admin"):
        r = client.post("/api/v1/auth/login", json={"email": f"{role}@procurax.demo", "password": "Demo@12345"})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}
    return _login


@pytest.fixture(autouse=True)
def _no_real_llm(monkeypatch):
    """Tests must never call a real LLM (cost, flakiness, rate limits). Tests that need an LLM inject a fake via set_provider_override."""
    from app.core.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "anthropic_api_key", "")
    monkeypatch.setattr(s, "groq_api_key", "")
