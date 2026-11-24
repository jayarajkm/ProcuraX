"""Reset + reseed must reproduce identical business data (fixed seed). Destructive: runs only when RUN_DESTRUCTIVE_TESTS=1."""
import os
import pytest
from sqlalchemy import text
from app.database import seed
from app.database.session import SessionLocal

pytestmark = pytest.mark.skipif(os.getenv("RUN_DESTRUCTIVE_TESTS") != "1", reason="destructive: wipes and reseeds the database")

FP = """select md5(string_agg(sku||name||unit_price::text, ',' order by sku)) from products
        union all select md5(string_agg(po_number||total_amount::text||status, ',' order by po_number)) from purchase_orders
        union all select md5(string_agg(code||avg_lead_time_days::text||rating::text, ',' order by code)) from suppliers"""


def fingerprint():
    with SessionLocal() as db:
        return [r[0] for r in db.execute(text(FP))]


def test_reset_and_reseed_is_reproducible():
    a = fingerprint()
    seed.run(reset_first=True)
    b = fingerprint()
    assert a == b
