from typing import Any
from sqlalchemy import func, select
from sqlalchemy.orm import Session


def paginate(db: Session, stmt, page: int, page_size: int, sort_map: dict[str, Any] | None = None,
             sort: str | None = None, order: str = "asc", default_sort: Any = None) -> dict:
    """Run a paginated, whitelisted-sort query. `sort_map` maps public names to columns (prevents injection)."""
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    col = (sort_map or {}).get(sort or "", default_sort)
    if col is not None:
        stmt = stmt.order_by(col.desc() if order == "desc" else col.asc())
    rows = db.execute(stmt.limit(page_size).offset((page - 1) * page_size)).unique().scalars().all()
    return {"items": rows, "total": total, "page": page, "page_size": page_size}
