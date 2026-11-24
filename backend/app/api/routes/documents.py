import uuid
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.deps import audit, require
from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.database.session import get_db
from app.models import Document, DocumentChunk, User
from app.repositories.base import paginate
from app.services import documents as svc

router = APIRouter(prefix="/documents", tags=["documents"])
CATEGORIES = {"policy", "procedure", "guideline", "standard", "contract", "general"}


def _out(d: Document) -> dict:
    return {"id": d.id, "title": d.title, "filename": d.filename, "file_type": d.file_type, "category": d.category, "size_bytes": d.size_bytes,
            "status": d.status, "error": d.error, "metadata": d.meta, "created_at": d.created_at, "updated_at": d.updated_at}


@router.get("")
def list_documents(status: str | None = None, category: str | None = None, q: str | None = None, page: int = Query(1, ge=1),
                   page_size: int = Query(25, ge=1, le=100), db: Session = Depends(get_db), _: User = Depends(require("document:read"))):
    stmt = select(Document)
    if status: stmt = stmt.where(Document.status == status)
    if category: stmt = stmt.where(Document.category == category)
    if q: stmt = stmt.where(Document.title.ilike(f"%{q}%"))
    r = paginate(db, stmt, page, page_size, default_sort=Document.created_at, order="desc")
    r["items"] = [_out(d) for d in r["items"]]
    return r


@router.post("", status_code=201)
async def upload(file: UploadFile = File(...), title: str | None = Form(None), category: str = Form("general"),
                 db: Session = Depends(get_db), user: User = Depends(require("document:write"))):
    if category not in CATEGORIES:
        raise AppError("invalid_category", f"Category must be one of {sorted(CATEGORIES)}", 422)
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)  # bounded read: never buffer more than limit+1 bytes
    d = svc.upload(db, user, file.filename or "upload", data, title, category)
    audit(db, user, "document.upload", "document", d.id, filename=d.filename); db.commit()
    return _out(d)


@router.get("/search")
def search(q: str = Query(min_length=2), top_k: int = Query(5, ge=1, le=20), min_similarity: float = Query(0.3, ge=0, le=1), category: str | None = None,
           db: Session = Depends(get_db), _: User = Depends(require("document:read"))):
    hits = svc.search_chunks(db, q, top_k, min_similarity, category)
    return {"query": q, "results": [{**h, "document_id": h["document_id"]} for h in hits]}


def _get(db, did) -> Document:
    d = db.get(Document, did)
    if not d: raise NotFound("Document")
    return d


@router.get("/{did}")
def get_document(did: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("document:read"))):
    return _out(_get(db, did))


@router.get("/{did}/chunks")
def chunks(did: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(require("document:read"))):
    _get(db, did)
    rows = db.scalars(select(DocumentChunk).where(DocumentChunk.document_id == did).order_by(DocumentChunk.chunk_index))
    return [{"chunk_index": c.chunk_index, "page": c.page_number, "content": c.content, "embedding_model": c.embedding_model} for c in rows]


@router.post("/{did}/reprocess")
def reprocess(did: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require("document:write"))):
    d = _get(db, did); svc.reprocess(db, d); audit(db, user, "document.reprocess", "document", did); db.commit()
    return _out(d)


@router.delete("/{did}", status_code=204)
def delete(did: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require("document:write"))):
    d = _get(db, did); svc.delete_document(db, d); audit(db, user, "document.delete", "document", did); db.commit()
