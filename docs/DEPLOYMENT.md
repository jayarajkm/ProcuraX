# Deployment — single DigitalOcean Droplet (Docker Compose)

> **Nothing here creates or pays for cloud resources.** Every step is run by you, on a server you create. The stack was
> tested end to end **locally** (isolated Compose project, HTTP mode): fresh DB, migrations, seed, embeddings, model
> training as the non-root user, smoke test through nginx, backup → damage → restore, persistence across restarts.
> **Not tested:** the real droplet, DNS, and the Let's Encrypt/HTTPS path (needs a real domain).

## 1. Architecture on the VM
```
Internet ──443/80──► nginx ──/api,/docs,/health──► backend (uvicorn x2) ──► postgres (pgvector)   [internal network]
                       └──/ ──────────────────────► frontend (static SPA)         worker ──► postgres, uploads volume
```
Only nginx publishes ports. Postgres, backend, worker and frontend are reachable only on the internal Docker network.
Volumes: `pgdata` (database), `uploads` (documents), `models` (ML artefacts + embedding-model cache), `letsencrypt`, `certbot-www`.

## 2. VM requirements (you create this)
| Item | Minimum | Why |
|---|---|---|
| Image | Ubuntu 24.04 LTS | |
| Size | **4 GB RAM / 2 vCPU** recommended; **2 GB** works with `UVICORN_WORKERS=1` + swap; **1 GB does not fit** | measured: API process ~0.43 GB once the embedding model is loaded, embedding job ~0.48 GB peak, Postgres 0.05-0.2 GB. Disk: images ~2.5 GB + data, so 25-50 GB is plenty; RAM is the constraint |
| Region | closest to users | |
| Auth | SSH key only (disable password login) | |
| DNS | `A` record `DOMAIN → droplet IP` (before step 5) | Let's Encrypt validation |
| Firewall | 22, 80, 443 inbound only | `provision-droplet.sh` configures `ufw`; optionally add a DigitalOcean Cloud Firewall too |

Approximate cost: a 4 GB droplet is on the order of tens of USD/month — check current DigitalOcean pricing. Enable DO backups/snapshots if you want a second safety net.

## 2b. Running on a 1 GB server (budget profile)
The default stack needs ~1.5 GB because each process may load a local embedding model. A 1 GB droplet is possible only with these changes (all supported by the repo):

| Change | How | Saves |
|---|---|---|
| No local embedding model | `.env.prod`: `LOCAL_EMBEDDINGS=0`, `EMBEDDING_PROVIDER=openai` (or `cohere`), `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` (384 dims) | ~0.45 GB per process + ~1.8 GB disk |
| API loads ML libs on demand | built in (pandas/scikit-learn are imported only when an ML endpoint is used; a test guards this) | ~110 MB at startup |
| One API worker, small DB pool | `UVICORN_WORKERS=1`, `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=2` | ~100-200 MB |
| Postgres tuned for a small box | `PG_SHARED_BUFFERS=64MB`, `PG_MAX_CONNECTIONS=25` | ~100 MB |
| Per-container memory caps | `POSTGRES_MEM=256m BACKEND_MEM=360m WORKER_MEM=180m NGINX_MEM=40m FRONTEND_MEM=40m` | a runaway process is OOM-killed alone, not the host |
| 2 GB swap | added by `provision-droplet.sh` | safety net (slow, not a substitute for RAM) |

Copy the commented "1 GB SERVER PROFILE" block from `.env.prod.example`. **Hosted embeddings need a key and send your document text and questions to that provider** — pick one whose terms you accept (some free/trial keys forbid production or commercial use; check current terms and prices yourself). Changing the embedding model invalidates stored vectors: run `python -m app.workers.runner --reindex-all --once` afterwards (search refuses mismatched vectors instead of returning wrong results).

**Expect on 1 GB:** ~0.5-0.7 GB used when idle, so little headroom; one person at a time; slow first requests after idle (swap); large PDF uploads and **ML retraining from the UI can OOM** (train once at deploy time, use the Retrain button rarely). **Build images on the droplet only with swap enabled** (the frontend build is capped at 640 MB heap), or build elsewhere for `linux/amd64` (an Apple-silicon Mac builds arm64 by default). The 1 GB profile was verified locally with the same limits in an isolated Compose project (see numbers in section 11); it has **not** been run on a real 1 GB droplet.

## 3. One-time setup (on the droplet)
```bash
# as root, on a fresh droplet (read the script first)
curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/provision-droplet.sh | bash   # or copy it over with scp
# then as user procurax:
git clone <your repo> ~/procuraX && cd ~/procuraX
cp .env.prod.example .env.prod && chmod 600 .env.prod
```
Fill **every** value in `.env.prod`:
- `openssl rand -hex 32` for `JWT_SECRET`; `openssl rand -hex 16` for `POSTGRES_PASSWORD` (use the same password inside `DATABASE_URL`).
- `DOMAIN`, `LETSENCRYPT_EMAIL`, `CORS_ORIGINS=https://<DOMAIN>`.
- LLM: set `AI_PROVIDER` and **only** that provider's key (`GROQ_API_KEY` or `ANTHROPIC_API_KEY`). Keys stay on the server; the browser never sees them.

The backend **refuses to start** with `ENVIRONMENT=production` if `JWT_SECRET` is short/default, the DB password is a known default, or CORS allows localhost/`*`.

## 4. First deployment
```bash
deploy/deploy.sh                       # builds images, runs migrations (migrate service), starts everything on HTTP
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend python -m app.database.seed
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend python -m app.workers.runner --enqueue-uploaded --once
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend python -m app.ml.train
scripts/smoke_test.sh http://<DOMAIN>  # expect ALL PASSED
```
**Change the demo passwords** before showing anyone outside your team (all four demo users share one published password):
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm backend python -m app.database.users set-password admin@procurax.demo
```
(repeat per account, or remove the demo users you don't need). Seeded data is **synthetic** and flagged as such in the UI.

## 5. HTTPS (Let's Encrypt)
After DNS resolves to the droplet:
```bash
deploy/init-tls.sh
```
It serves HTTP, obtains the certificate via webroot challenge, switches nginx to the HTTPS config (HTTP → HTTPS redirect, HSTS, security headers) and starts the `certbot` renewal container (checks every 12 h). Verify: `curl -I https://<DOMAIN>/health`.

## 6. Backups & restore
```bash
deploy/backup.sh manual               # → /var/backups/procurax/db-<ts>-manual.dump + files-<ts>-manual.tgz (DB, uploads, models)
```
Schedule daily (`crontab -e`): `30 2 * * * cd /home/procurax/procuraX && deploy/backup.sh daily >> /var/log/procurax-backup.log 2>&1` (keeps 14 by default; `KEEP=30`).
**Copy backups off the droplet** (e.g. `rclone`/`scp` to object storage) — a backup on the same disk does not protect against losing the droplet.
```bash
deploy/restore.sh /var/backups/procurax/db-<ts>-daily.dump /var/backups/procurax/files-<ts>-daily.tgz   # DESTRUCTIVE: type RESTORE to confirm
```
Restore drops and recreates the database, re-creates the `vector` extension, restores, then restarts backend/worker. Tested locally (damage → restore → data identical).

## 7. Updates & rollback
```bash
git pull && deploy/deploy.sh          # takes a pre-deploy backup, rebuilds, migrations run automatically, records the git version
deploy/rollback.sh                    # checks out the previous deployed version and redeploys
```
Rollback reverts **code only**. Alembic migrations are forward-only; if a migration must be undone, restore the `pre-deploy` backup with `deploy/restore.sh`.
Schema changes always go through Alembic (`alembic revision --autogenerate`), never by hand.

## 8. Operations cheatsheet
```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C ps ; $C logs -f backend ; $C logs -f worker
$C exec postgres psql -U procurax procurax_db      # admin access to the DB is via the container only (never exposed publicly)
$C restart backend worker
```
Health: `GET /health` (DB + pgvector + migration revision). Audit trail: AI Administration → Audit log.

## 9. Security checklist
- [ ] SSH key login only; `ufw` active (22/80/443); fail2ban installed (`provision-droplet.sh`).
- [ ] `.env.prod` is `chmod 600`, never committed (git-ignored).
- [ ] Demo passwords changed; unused demo users removed.
- [ ] `docker compose ps` shows **no** published port for postgres (`5432/tcp` only).
- [ ] HTTPS working and HTTP redirects; HSTS header present.
- [ ] `DOCS_ENABLED=false` if you do not want the OpenAPI docs public.
- [ ] Backups copied off-box and a restore rehearsed.
- [ ] LLM provider spend limits set in the provider console.

## 10b. Measured on the 1 GB profile (isolated local Compose project, mock embedding server)
| Check | Result |
|---|---|
| Backend image (no torch) | 1.32 GB vs 2.25 GB with local embeddings |
| API process at startup | ~107 MB (was ~220 MB before lazy ML imports) |
| Steady-state containers (after seed, indexing, training) | backend ~168 MB, worker ~70 MB, postgres ~37 MB, nginx ~8 MB, frontend ~7 MB (**~290 MB total**) |
| Seed, document indexing (10 docs), full model training in one-off containers capped at 360 MB | all succeeded |
| `POST /ml/train` through the running API (cap 360 MB) | HTTP 200 in ~1.7 s, sampled peak ~193 MB, no OOM kill |
| Smoke test through nginx | ALL PASSED |
**Not measured / not verified:** a real hosted embeddings provider (a hashed bag-of-words mock stood in, so semantic quality was not evaluated), a real 1 GB droplet (the OS and Docker daemon take roughly 200-300 MB of the 1 GB), concurrent users, and large PDF uploads. Treat 1 GB as a single-user demo configuration.

## 10. Known limitations
- Single VM, no high availability; Postgres on a local volume (use DO Managed Postgres for production-grade durability — `DATABASE_URL` change + remove the postgres service).
- Free-tier LLM keys are rate limited; the agent may fail or be slow when limits are hit (it reports this, it does not fake results).
- Embedding model downloads from Hugging Face on first use (needs outbound internet; cached in the `models` volume).
- Rate limiting is per client IP at nginx and in the app (slowapi, in-memory per worker).
