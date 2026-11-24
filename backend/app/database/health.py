from sqlalchemy import text
from sqlalchemy.orm import Session


def check_database(db: Session) -> dict:
    db.execute(text("SELECT 1"))
    ext = db.execute(text("SELECT extname FROM pg_extension WHERE extname='vector'")).scalar()
    rev = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    return {"database": "ok", "pgvector": bool(ext), "migration": rev}
