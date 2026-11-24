"""Document-processing worker: polls document_processing_jobs (Postgres-backed queue, no Redis).

  python -m app.workers.runner            # run forever
  python -m app.workers.runner --once     # drain the queue and exit
  python -m app.workers.runner --enqueue-uploaded --once   # also queue documents that were never processed (e.g. seeded)
"""
import argparse
import logging
import time
from datetime import datetime, timezone
from sqlalchemy import select
from app.database.session import SessionLocal
from app.models import Document, DocumentProcessingJob
from app.services import documents as docs

log = logging.getLogger("worker")


def claim(db):
    job = db.scalar(select(DocumentProcessingJob).where(DocumentProcessingJob.status == "queued")
                    .order_by(DocumentProcessingJob.created_at).with_for_update(skip_locked=True).limit(1))
    if job:
        job.status, job.started_at, job.attempts = "running", datetime.now(timezone.utc), job.attempts + 1
        db.commit()
    return job


def run_once() -> int:
    n = 0
    while True:
        with SessionLocal() as db:
            job = claim(db)
            if not job:
                return n
            try:
                docs.process_document(db, job.document_id)
                job = db.get(DocumentProcessingJob, job.id); job.status = "done"
            except Exception as e:
                job = db.get(DocumentProcessingJob, job.id); job.status, job.error = "failed", str(e)[:500]
                log.error("job %s failed: %s", job.id, e)
            job.finished_at = datetime.now(timezone.utc); db.commit(); n += 1


def enqueue_uploaded():
    with SessionLocal() as db:
        for d in db.scalars(select(Document).where(Document.status == "uploaded")):
            if not db.scalar(select(DocumentProcessingJob.id).where(DocumentProcessingJob.document_id == d.id, DocumentProcessingJob.status.in_(("queued", "running")))):
                docs.enqueue(db, d)
        db.commit()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(); ap.add_argument("--once", action="store_true"); ap.add_argument("--enqueue-uploaded", action="store_true")
    a = ap.parse_args()
    if a.enqueue_uploaded:
        enqueue_uploaded()
    if a.once:
        print("processed", run_once())
    else:
        while True:
            if not run_once():
                time.sleep(3)
