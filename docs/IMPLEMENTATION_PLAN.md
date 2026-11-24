# Implementation Plan

Status legend: [ ] todo, [~] in progress, [x] done

- [x] Phase 0 — docs
- [x] Phase 1 — Postgres/pgvector in Docker, models, Alembic, seeders, reset-and-reseed, validation tests
- [x] Phase 2 — FastAPI, auth/RBAC, CRUD, dashboard, tests
- [x] Phase 3 (built + build/tests pass; not click-tested in a browser) — React shell + business pages
- [x] Phase 4 — Rule-based, NLP, ML (train + evaluate)
- [x] Phase 5 (LLM path untested against real API) — LLM provider, chat history, RAG
- [x] Phase 6 backend (tested with scripted provider) — Agent tools, planner, approvals
- [x] Phase 7 — comparison, AI analytics, insights, admin (UI not browser-tested)
- [~] Phase 8 — prod config + scripts built and tested locally; real droplet/DNS/HTTPS NOT done (needs approval)

Rule: a phase is complete only when its tests pass and its docs are updated.
