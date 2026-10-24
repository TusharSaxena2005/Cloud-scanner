"""Provider-neutral connections with a Google authorization-code adapter."""
import base64
from datetime import timedelta
import hashlib
import hmac
import json
import secrets
import time
from urllib.parse import urlencode, urlparse

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
from google.oauth2.credentials import Credentials
from sqlalchemy import DateTime, bindparam, delete, select, text

from app.auth import COOKIE, create_google_user, csrf_guard, require_scanner_user, require_user, start_session, token_hash
from app.config import settings
from app.database import AuthRateLimit, BrowserSession, CloudConnection, Membership, OAuthAttempt, User, Workspace, get_db, now

router = APIRouter(prefix="/api", tags=["Cloud connections"])
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GCP_SCOPE = "https://www.googleapis.com/auth/cloud-platform.read-only"
LOGIN_SCOPES = {"openid", "email", "profile"}


def configured():
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(503, "Google Sign-In is not configured.")
    parsed = urlparse(settings.public_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise HTTPException(503, "PUBLIC_URL must be the application's origin.")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise HTTPException(503, "PUBLIC_URL requires HTTPS outside local development.")
    if parsed.scheme == "https" and not settings.session_cookie_secure:
        raise HTTPException(503, "Enable secure session cookies for HTTPS.")


def cipher():
    try:
        return Fernet(settings.credential_encryption_key.encode())
    except (ValueError, TypeError):
        raise HTTPException(503, "Cloud connection encryption is not configured.") from None


def seal(value):
    return cipher().encrypt(json.dumps(value).encode()).decode()


def unseal(value):
    try:
        return json.loads(cipher().decrypt(value.encode()))
    except (InvalidToken, ValueError):
        raise HTTPException(503, "Cloud credentials cannot be decrypted. Check the encryption key.") from None


def member(db, user_id, workspace_id):
    membership = db.get(Membership, (user_id, workspace_id))
    if not membership:
        raise HTTPException(404, "Workspace not found.")
    return membership


def connection_for_user(db, user, connection_id):
    connection = db.get(CloudConnection, connection_id)
    if connection is None:
        raise HTTPException(404, "Cloud connection not found.")
    member(db, user.id, connection.workspace_id)
    if connection.provider != "gcp":
        raise HTTPException(400, "This scanner requires a GCP connection.")
    return connection


def public_connection(connection):
    return {"id": connection.id, "workspace_id": connection.workspace_id,
            "provider": connection.provider, "label": connection.label,
            "created_at": connection.created_at.isoformat()}


@router.get("/workspaces")
def workspaces(response: Response, user=Depends(require_user), db=Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    items = db.scalars(select(Workspace).join(Membership).where(Membership.user_id == user.id)).all()
    return {"workspaces": [{"id": w.id, "name": w.name} for w in items]}


@router.get("/connections")
def connections(response: Response, user=Depends(require_user), db=Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    items = db.scalars(select(CloudConnection).join(Membership,
        Membership.workspace_id == CloudConnection.workspace_id).where(Membership.user_id == user.id)).all()
    return {"connections": [public_connection(c) for c in items],
            "providers": [{"id": "gcp", "available": True}, {"id": "aws", "available": False},
                          {"id": "azure", "available": False}]}


@router.delete("/connections/{connection_id}", dependencies=[Depends(csrf_guard)])
def disconnect(connection_id: str, user=Depends(require_scanner_user), db=Depends(get_db)):
    connection = connection_for_user(db, user, connection_id)
    if member(db, user.id, connection.workspace_id).role != "owner":
        raise HTTPException(403, "Only workspace owners can disconnect accounts.")
    # Revoking Google's combined grant could affect the same user's other workspaces.
    db.delete(connection)
    db.commit()
    return {"ok": True}


def begin_oauth(purpose, request, db, user=None, workspace_id=None):
    configured()
    if purpose == "gcp":
        cipher()
    window = int(time.time()) // 900
    ip = request.client.host if request.client else "unknown"
    key = token_hash(f"oauth:{ip}:{window}")
    db.execute(delete(AuthRateLimit).where(AuthRateLimit.expires_at <= now()))
    count = db.execute(text("INSERT INTO auth_rate_limits (key, attempts, expires_at) "
        "VALUES (:key, 1, :expires) ON CONFLICT (key) DO UPDATE "
        "SET attempts = auth_rate_limits.attempts + 1 RETURNING attempts").bindparams(
            bindparam("expires", type_=DateTime(timezone=True))),
        {"key": key, "expires": now() + timedelta(minutes=15)}).scalar_one()
    db.commit()
    if count > 50:
        raise HTTPException(429, "Too many sign-in attempts. Please try again in 15 minutes.")
    state, binding = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    verifier, nonce = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    db.execute(delete(OAuthAttempt).where(OAuthAttempt.expires_at <= now()))
    old_binding = request.cookies.get("cloudscanner_oauth")
    if old_binding:
        db.execute(delete(OAuthAttempt).where(OAuthAttempt.binding_hash == token_hash(old_binding)))
    db.add(OAuthAttempt(state_hash=token_hash(state), binding_hash=token_hash(binding), purpose=purpose,
        user_id=user.id if user else None, workspace_id=workspace_id,
        session_hash=token_hash(request.cookies[COOKIE]) if user else None,
        nonce=nonce, verifier=verifier, expires_at=now() + timedelta(minutes=10)))
    db.commit()
    params = {"client_id": settings.google_client_id,
        "redirect_uri": settings.public_url.rstrip("/") + "/api/oauth/google/callback",
        "response_type": "code", "scope": " ".join(sorted(LOGIN_SCOPES | ({GCP_SCOPE} if purpose == "gcp" else set()))),
        "state": state, "nonce": nonce,
        "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode(),
        "code_challenge_method": "S256"}
    if purpose == "gcp":
        params.update(access_type="offline", prompt="consent", login_hint=user.email)
    response = Response(content=json.dumps({"url": GOOGLE_AUTH + "?" + urlencode(params)}), media_type="application/json")
    response.set_cookie("cloudscanner_oauth", binding, max_age=600, httponly=True,
                        secure=settings.session_cookie_secure, samesite="lax", path="/api")
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/auth/google/start", dependencies=[Depends(csrf_guard)])
def login_start(request: Request, db=Depends(get_db)):
    return begin_oauth("login", request, db)


@router.post("/workspaces/{workspace_id}/connections/gcp/start", dependencies=[Depends(csrf_guard)])
def gcp_start(workspace_id: str, request: Request, user=Depends(require_scanner_user), db=Depends(get_db)):
    if member(db, user.id, workspace_id).role != "owner":
        raise HTTPException(403, "Only workspace owners can connect accounts.")
    return begin_oauth("gcp", request, db, user, workspace_id)


def exchange_code(code, verifier):
    try:
        with httpx.Client(timeout=20) as client:
            response = client.post(GOOGLE_TOKEN, data={"code": code, "code_verifier": verifier,
                "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
                "redirect_uri": settings.public_url.rstrip("/") + "/api/oauth/google/callback",
                "grant_type": "authorization_code"})
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(400, "Google authorization failed. Please start again.") from None


def verify_identity(encoded, nonce):
    try:
        claims = id_token.verify_oauth2_token(encoded, GoogleRequest(), settings.google_client_id)
        if not claims.get("sub") or not claims.get("email") or not claims.get("email_verified"):
            raise ValueError("Unverified identity")
        if not hmac.compare_digest(claims.get("nonce", ""), nonce):
            raise ValueError("Nonce mismatch")
        return claims
    except (ValueError, GoogleAuthError, TypeError):
        raise HTTPException(400, "Google identity could not be verified. Please start again.") from None


@router.get("/oauth/google/callback")
def callback(request: Request, state: str = "", code: str = "", error: str = "", db=Depends(get_db)):
    configured()
    binding = request.cookies.get("cloudscanner_oauth", "")
    # Consume state atomically before exchanging the code to prevent replay.
    attempt = db.execute(delete(OAuthAttempt).where(OAuthAttempt.state_hash == token_hash(state),
        OAuthAttempt.binding_hash == token_hash(binding), OAuthAttempt.expires_at > now()).returning(OAuthAttempt)).scalar_one_or_none()
    db.commit()
    if attempt is None:
        raise HTTPException(400, "Authorization expired or invalid. Please start again.")
    target = "connections" if attempt.purpose == "gcp" else "login"

    def finish(message=None):
        fragment = f"/#/{target}" + ("?" + urlencode({"oauth_error": message}) if message else "")
        result = RedirectResponse(settings.public_url.rstrip("/") + fragment, status_code=303)
        result.delete_cookie("cloudscanner_oauth", path="/api", secure=settings.session_cookie_secure,
                             httponly=True, samesite="lax")
        result.headers["Cache-Control"] = "no-store"
        result.headers["Referrer-Policy"] = "no-referrer"
        return result

    if error or not code:
        return finish("Google authorization was cancelled. You can try again.")
    try:
        user = None
        if attempt.purpose == "gcp":
            session = db.scalar(select(BrowserSession).where(
                BrowserSession.token_hash == token_hash(request.cookies.get(COOKIE, "")),
                BrowserSession.token_hash == attempt.session_hash, BrowserSession.expires_at > now(),
                BrowserSession.user_id == attempt.user_id))
            if session is None:
                raise HTTPException(401, "Sign in again before connecting Google Cloud.")
            user = db.get(User, attempt.user_id)
            if member(db, user.id, attempt.workspace_id).role != "owner":
                raise HTTPException(403, "Workspace ownership is required.")
        tokens = exchange_code(code, attempt.verifier)
        claims = verify_identity(tokens.get("id_token"), attempt.nonce)
        if attempt.purpose == "login":
            user = create_google_user(db, claims)
            response = finish()
            response.headers["Location"] = settings.public_url.rstrip("/") + "/#/scanner"
            start_session(user, request, response, db)
            return response
        if claims["sub"] != user.google_sub:
            raise HTTPException(400, "Connect the same Google account you used to sign in.")
        scopes = set(tokens.get("scope", "").split())
        if GCP_SCOPE not in scopes:
            raise HTTPException(400, "Google Cloud read access was not granted. Reconnect and approve it.")
        connection = db.scalar(select(CloudConnection).where(CloudConnection.workspace_id == attempt.workspace_id,
            CloudConnection.provider == "gcp", CloudConnection.provider_subject == claims["sub"]))
        refresh = tokens.get("refresh_token")
        if not refresh and connection:
            refresh = unseal(connection.encrypted_credentials).get("refresh_token")
        if not refresh:
            raise HTTPException(400, "Google did not grant offline access. Reconnect and approve consent.")
        encrypted = seal({"refresh_token": refresh})
        if connection is None:
            connection = CloudConnection(workspace_id=attempt.workspace_id, created_by=user.id,
                provider="gcp", provider_subject=claims["sub"])
            db.add(connection)
        connection.label = claims["email"]
        connection.encrypted_credentials = encrypted
        connection.scopes = " ".join(sorted(scopes))
        db.commit()
        return finish()
    except HTTPException as exc:
        db.rollback()
        return finish(exc.detail)


def scan_credentials(connection_id: str, user=Depends(require_scanner_user), db=Depends(get_db)):
    configured()
    connection = connection_for_user(db, user, connection_id)
    data = unseal(connection.encrypted_credentials)
    credentials = Credentials(token=None, refresh_token=data["refresh_token"], token_uri=GOOGLE_TOKEN,
        client_id=settings.google_client_id, client_secret=settings.google_client_secret, scopes=[GCP_SCOPE])
    try:
        credentials.refresh(GoogleRequest())
    except GoogleAuthError:
        raise HTTPException(409, "Google Cloud access expired or was revoked. Reconnect this account.") from None
    return credentials, connection.label
