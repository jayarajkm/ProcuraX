from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings

_s = get_settings()
engine = create_engine(_s.database_url, pool_pre_ping=True, pool_size=_s.db_pool_size, max_overflow=_s.db_max_overflow)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
