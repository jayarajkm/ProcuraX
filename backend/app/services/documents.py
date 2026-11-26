import os
import re
import uuid
from datetime import datetime, timezone
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.ingestion import extract as X
from app.ingestion.embeddings import get_embedder
from app.models import Document, DocumentChunk, DocumentProcessingJob, User


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(name))[:120] or "file"


def upload(db: Session, user: User, filename: str, data: bytes, title: str | None, category: str) -> Document:
    s = get_settings()
    try:
        ext = X.validate_upload(filename, data, s.max_upload_mb * 1024 * 1024)
    except X.ExtractionError as e:
        raise AppError("invalid_upload", str(e), 422)
    os.makedirs(s.upload_dir, exist_ok=True)
    path = os.path.join(s.upload_dir, f"{uuid.uuid4().hex}_{safe_name(filename)}")
    with open(path, "wb") as f:
        f.write(data)
    d = Document(organization_id=user.organization_id, title=title or filename, filename=filename, file_type=ext, category=category,
                 storage_path=path, size_bytes=len(data), status="uploaded", uploaded_by=user.id)
    db.add(d); db.flush()
    enqueue(db, d)
    return d


def enqueue(db: Session, d: Document):
    db.add(DocumentProcessingJob(document_id=d.id, status="queued"))
    d.status, d.error = "uploaded", None
    db.flush()


def reprocess(db: Session, d: Document):
    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == d.id))
    enqueue(db, d)


def delete_document(db: Session, d: Document):
    try:
        os.remove(d.storage_path)
    except FileNotFoundError:
        pass
    db.delete(d)


def process_document(db: Session, doc_id) -> int:
    """Extract -> chunk -> embed -> store. Returns chunk count. Raises on failure after marking the document failed."""
    d = db.get(Document, doc_id)
    if not d:
        raise NotFound("Document")
    d.status = "processing"; db.commit()
    try:
        pages = X.extract(d.storage_path, d.file_type)
        chunks = X.chunk_text(pages)
        if not chunks:
            raise X.ExtractionError("No extractable text found in the document")
        emb = get_embedder()
        vecs = emb.embed([c["content"] for c in chunks], "document")
        db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == d.id))
        for i, (c, v) in enumerate(zip(chunks, vecs)):
            db.add(DocumentChunk(document_id=d.id, chunk_index=i, content=c["content"], page_number=c["page"], embedding=v,
                                 embedding_model=emb.model_name, meta={"chars": len(c["content"])}))
        d.status, d.error = "indexed", None
        d.meta = {**(d.meta or {}), "chunks": len(chunks), "pages": len(pages), "indexed_at": datetime.now(timezone.utc).isoformat()}
        db.commit()
        return len(chunks)
    except Exception as e:
        db.rollback()
        d = db.get(Document, doc_id)
        d.status, d.error = "failed", str(e)[:500]
        db.commit()
        raise


def search_chunks(db: Session, query: str, top_k: int = 4, min_similarity: float = 0.30, category: str | None = None) -> list[dict]:
    emb = get_embedder()
    total = db.scalar(select(func.count()).select_from(DocumentChunk)) or 0
    mine = db.scalar(select(func.count()).select_from(DocumentChunk).where(DocumentChunk.embedding_model == emb.model_name)) or 0
    if total and not mine:  # vectors from different models are not comparable: refuse instead of returning garbage
        from app.ingestion.embeddings import EmbeddingError
        raise EmbeddingError(f"Documents were indexed with a different embedding model than the current '{emb.model_name}'. "
                             "Re-index them: python -m app.workers.runner --reindex-all --once")
    qv = emb.embed([query], "query")[0]
    dist = DocumentChunk.embedding.cosine_distance(qv)
    stmt = (select(DocumentChunk, Document, (1 - dist).label("sim")).join(Document, Document.id == DocumentChunk.document_id)
            .where(Document.status == "indexed", DocumentChunk.embedding_model == emb.model_name).order_by(dist).limit(top_k))
    if category:
        stmt = stmt.where(Document.category == category)
    return [{"document_id": d.id, "title": d.title, "filename": d.filename, "chunk_index": c.chunk_index, "page": c.page_number,
             "similarity": round(float(sim), 4), "content": c.content}
            for c, d, sim in db.execute(stmt) if sim >= min_similarity]
