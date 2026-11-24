# ProcuraX AI

AI-powered procurement intelligence platform (all data is **synthetic demo data**). See `docs/`.

## Quick start (dev)
```bash
cp .env.example .env            # then edit secrets
docker compose up -d postgres
docker compose run --rm backend alembic upgrade head
docker compose run --rm backend python -m app.database.seed          # seed empty DB
docker compose run --rm backend python -m app.database.seed --reset  # DESTRUCTIVE: wipe + reseed
docker compose run --rm backend pytest -q
```
Demo logins (password `Demo@12345`): admin@ / manager@ / buyer@ / viewer@ `procurax.demo`.
Postgres is only reachable on the internal Docker network.
