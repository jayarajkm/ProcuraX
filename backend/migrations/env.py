from alembic import context
from sqlalchemy import create_engine, pool
from app.core.config import get_settings
from app.models import Base

target_metadata = Base.metadata
url = get_settings().database_url


def run_migrations_online():
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
