"""Reset-and-reseed CLI.

  python -m app.database.seed            # seed an empty database
  python -m app.database.seed --reset    # DESTRUCTIVE: truncate all data tables, then reseed
"""
import argparse
from sqlalchemy import select, text
from app.core.config import get_settings
from app.database.base import Base
from app.database.session import SessionLocal, engine
import app.models  # noqa
from app.models import Organization
from app.database.seeding.reference import seed_reference
from app.database.seeding.business import seed_business
from app.database.seeding.documents import seed_documents


def reset(db):
    names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    db.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    db.commit()


def run(reset_first: bool = False) -> dict:
    s = get_settings()
    with SessionLocal() as db:
        if reset_first:
            reset(db)
        if db.scalar(select(Organization.id).limit(1)):
            raise SystemExit("Database already seeded. Use --reset to wipe and reseed.")
        org = Organization(name="Demo Manufacturing Co (synthetic)", is_demo_data=True)
        db.add(org); db.flush()
        ref = seed_reference(db, org)
        stats = seed_business(db, org, ref, s.seed)
        stats["documents"] = seed_documents(db, org, ref["users"]["Administrator"].id, s.upload_dir)
        db.commit()
        return stats


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="truncate all tables first (destructive)")
    print(run(ap.parse_args().reset))
