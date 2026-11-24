import uuid
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from app.core.errors import AppError
from app.core.security import decode_token
from app.database.session import get_db
from app.models import AuditLog, User

bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    payload = decode_token(creds.credentials) if creds else None
    if not payload:
        raise AppError("unauthenticated", "Missing or invalid token", 401)
    user = db.get(User, uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise AppError("unauthenticated", "User not found or inactive", 401)
    return user


def user_permissions(user: User) -> set[str]:
    return {p.code for r in user.roles for p in r.permissions}


def require(perm: str):
    def dep(user: User = Depends(current_user)) -> User:
        if perm not in user_permissions(user):
            raise AppError("forbidden", f"Permission '{perm}' required", 403)
        return user
    return dep


def audit(db: Session, user: User | None, action: str, entity_type: str, entity_id="", **details):
    db.add(AuditLog(user_id=user.id if user else None, action=action, entity_type=entity_type, entity_id=str(entity_id), details=details))
