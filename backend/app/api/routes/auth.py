from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.deps import audit, current_user, user_permissions
from app.core.errors import AppError
from app.core.ratelimit import limiter
from app.core.security import create_access_token, verify_password
from app.database.session import get_db
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        audit(db, None, "login_failed", "user", body.email[:60]); db.commit()
        raise AppError("invalid_credentials", "Invalid email or password", 401)
    audit(db, user, "login", "user", user.id); db.commit()
    return {"access_token": create_access_token(str(user.id)), "token_type": "bearer"}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "full_name": user.full_name,
            "roles": [r.name for r in user.roles], "permissions": sorted(user_permissions(user))}
