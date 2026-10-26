"""Google OIDC identity and revocable PostgreSQL browser sessions."""
from datetime import timedelta
import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select

from app.config import settings
from app.database import BrowserSession, Membership, User, Workspace, get_db, now, uid
from app.demo import sample_workspace

COOKIE = "cloudscanner_session"
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_guard(request: Request):
    if request.headers.get("X-CloudScanner-Request") != "1":
        raise HTTPException(403, "Invalid request origin.")


def public_user(user):
    return {"id": user.id, "name": user.name, "email": user.email,
            "auth_provider": "demo" if user.is_demo else "google", "is_demo": user.is_demo,
            "sample_workspace": sample_workspace() if user.is_demo else None}


def start_session(user, request, response, db):
    token = secrets.token_urlsafe(32)
    old = request.cookies.get(COOKIE)
    if old:
        db.execute(delete(BrowserSession).where(BrowserSession.token_hash == token_hash(old)))
    db.execute(delete(BrowserSession).where(BrowserSession.expires_at <= now()))
    db.add(BrowserSession(token_hash=token_hash(token), user_id=user.id,
                          expires_at=now() + timedelta(hours=settings.session_hours)))
    db.commit()
    response.set_cookie(COOKIE, token, max_age=settings.session_hours * 3600,
                        httponly=True, secure=settings.session_cookie_secure,
                        samesite="lax", path="/api")
    response.headers["Cache-Control"] = "no-store"


def session_token(request: Request):
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 128:
        raise HTTPException(401, "Please sign in to continue.")
    return token


def require_user(token=Depends(session_token), db=Depends(get_db)):
    user = db.scalar(select(User).join(BrowserSession, BrowserSession.user_id == User.id).where(
        BrowserSession.token_hash == token_hash(token), BrowserSession.expires_at > now()))
    if user is None:
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    return user


def require_scanner_user(user=Depends(require_user)):
    if user.is_demo:
        raise HTTPException(403, "This demo account is for sample data only.")
    return user


def create_google_user(db, claims):
    # Never merge accounts by email. Google's subject is the verified identifier.
    user = db.scalar(select(User).where(User.google_sub == claims["sub"]))
    if user is None:
        user = User(google_sub=claims["sub"], email=claims["email"],
                    name=(claims.get("name") or claims["email"])[:100])
        db.add(user)
        db.flush()
        workspace = Workspace(name=f"{user.name}'s workspace"[:150])
        db.add(workspace)
        db.flush()
        db.add(Membership(user_id=user.id, workspace_id=workspace.id, role="owner"))
    else:
        user.email = claims["email"]
    return user


@router.post("/demo", dependencies=[Depends(csrf_guard)])
def login_demo(request: Request, response: Response, db=Depends(get_db)):
    user = db.scalar(select(User).where(User.google_sub == "demo-sub"))
    if user is None:
        user = User(id=uid(), google_sub="demo-sub", email="demo@cloudscanner.local",
                    name="Demo User", is_demo=True)
        db.add(user)
        db.flush()
        workspace = Workspace(name="Demo Workspace")
        db.add(workspace)
        db.flush()
        db.add(Membership(user_id=user.id, workspace_id=workspace.id, role="viewer"))
    else:
        user.is_demo = True
        membership = db.scalar(select(Membership).where(Membership.user_id == user.id))
        if membership is None:
            workspace = Workspace(name="Demo Workspace")
            db.add(workspace)
            db.flush()
            db.add(Membership(user_id=user.id, workspace_id=workspace.id, role="viewer"))
    db.commit()
    start_session(user, request, response, db)
    return {"user": public_user(user)}


@router.get("/me")
def me(response: Response, user=Depends(require_user)):
    response.headers["Cache-Control"] = "no-store"
    return {"user": public_user(user)}


@router.post("/logout", dependencies=[Depends(csrf_guard)])
def logout(request: Request, response: Response, db=Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        db.execute(delete(BrowserSession).where(BrowserSession.token_hash == token_hash(token)))
        db.commit()
    response.delete_cookie(COOKIE, path="/api", secure=settings.session_cookie_secure,
                           httponly=True, samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


class ProfileInput(BaseModel):
    model_config = {"extra": "forbid"}
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Enter your full name.")
        return value


@router.patch("/profile", dependencies=[Depends(csrf_guard)])
def update_profile(body: ProfileInput, response: Response, user=Depends(require_user), db=Depends(get_db)):
    user.name = body.name
    db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"user": public_user(user)}
