"""MongoDB-backed accounts and opaque, revocable browser sessions."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import hmac
import bcrypt
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError
from app.config import settings

COOKIE = "cloudscanner_session"
router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def initialize_indexes(db):
    db.users.create_index("email", unique=True)
    db.sessions.create_index("expires_at", expireAfterSeconds=0)
    db.auth_attempts.create_index("expires_at", expireAfterSeconds=0)


@lru_cache
def database():
    if not settings.mongodb_uri:
        raise HTTPException(503, "Account access is not configured.")
    client = None
    try:
        client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=10000,
                             connectTimeoutMS=15000, socketTimeoutMS=10000, tz_aware=True)
        db = client[settings.mongodb_database]
        initialize_indexes(db)
        return db
    except PyMongoError:
        if client is not None:
            client.close()
        raise HTTPException(503, "Account database is unavailable. Please try again later.") from None


def get_db():
    try:
        yield database()
    except PyMongoError:
        raise HTTPException(503, "Account database is unavailable. Please try again later.") from None


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256, repr=False)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return str(value).lower()


class SignupInput(LoginInput):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=256, repr=False)

    @field_validator("password")
    @classmethod
    def bcrypt_length(cls, value):
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes (fewer characters for some languages).")
        return value

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Enter your full name.")
        return value


def password_hash(password):
    # Never truncate: bcrypt accepts at most 72 UTF-8 bytes.
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")


DUMMY_HASH = password_hash(secrets.token_urlsafe(32))


def verify_password(password, encoded):
    try:
        if encoded.startswith(("$2a$", "$2b$", "$2y$")):
            return bcrypt.checkpw(password.encode("utf-8"), encoded.encode("ascii"))
        # Read-only compatibility for existing accounts; new hashes use bcrypt.
        algorithm, salt, digest = encoded.split("$")
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt),
                                n=32768, r=8, p=3, maxmem=64 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(actual.hex(), digest)
    except (ValueError, TypeError, AttributeError, UnicodeError):
        return False


def csrf_guard(request: Request):
    # Cross-origin forms cannot send this header. CORS allows only configured UI origins.
    if request.headers.get("X-CloudScanner-Request") != "1":
        raise HTTPException(403, "Invalid request origin.")


def limit_attempts(request, email, db):
    window = int(time.time()) // 900
    ip = request.client.host if request.client else "unknown"
    for kind, value, limit in [("ip", ip, 50), ("email", email, 15)]:
        key = hashlib.sha256(f"{kind}:{value}:{window}".encode()).hexdigest()
        record = db.auth_attempts.find_one_and_update(
            {"_id": key}, {"$inc": {"count": 1}, "$setOnInsert": {
                "expires_at": datetime.fromtimestamp((window + 1) * 900, timezone.utc)}},
            upsert=True, return_document=ReturnDocument.AFTER)
        if record["count"] > limit:
            raise HTTPException(429, "Too many attempts. Please try again in 15 minutes.")


def public_user(user):
    return {"id": str(user["_id"]), "name": user["name"], "email": user["email"],
            "is_demo": bool(user.get("is_demo")),
            "sample_workspace": user.get("sample_workspace") if user.get("is_demo") else None}


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(user, request, response, db):
    token = secrets.token_urlsafe(32)
    db.sessions.insert_one({"_id": token_hash(token), "user_id": user["_id"], "password_version": user.get("password_version", 0),
                            "expires_at": datetime.now(timezone.utc) + timedelta(hours=settings.session_hours)})
    old = request.cookies.get(COOKIE)
    if old:
        db.sessions.delete_one({"_id": token_hash(old)})
    response.set_cookie(COOKIE, token, max_age=settings.session_hours * 3600,
                        httponly=True, secure=settings.session_cookie_secure,
                        samesite="strict", path="/api")
    response.headers["Cache-Control"] = "no-store"
    return {"user": public_user(user)}


def session_token(request: Request):
    token = request.cookies.get(COOKIE)
    if not token or len(token) > 128:
        raise HTTPException(401, "Please sign in to continue.")
    return token


def require_user(token=Depends(session_token), db=Depends(get_db)):
    session = db.sessions.find_one({"_id": token_hash(token), "expires_at": {"$gt": datetime.now(timezone.utc)}})
    user = db.users.find_one({"_id": session["user_id"]}) if session else None
    if not user or session.get("password_version", 0) != user.get("password_version", 0):
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    return user


@router.post("/signup", status_code=201, dependencies=[Depends(csrf_guard)])
def signup(body: SignupInput, request: Request, response: Response, db=Depends(get_db)):
    limit_attempts(request, body.email, db)
    user = {"name": body.name, "email": body.email, "password_hash": password_hash(body.password),
            "created_at": datetime.now(timezone.utc)}
    try:
        db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, "Unable to create this account. Try signing in instead.") from None
    return start_session(user, request, response, db)


@router.post("/login", dependencies=[Depends(csrf_guard)])
def login(body: LoginInput, request: Request, response: Response, db=Depends(get_db)):
    limit_attempts(request, body.email, db)
    user = db.users.find_one({"email": body.email})
    valid = verify_password(body.password, user["password_hash"] if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, "Email or password is incorrect.")
    if user["password_hash"].startswith("scrypt$") and len(body.password.encode("utf-8")) <= 72:
        # Compare the old hash so concurrent password changes cannot be overwritten.
        db.users.update_one({"_id": user["_id"], "password_hash": user["password_hash"]},
                            {"$set": {"password_hash": password_hash(body.password)}})
    return start_session(user, request, response, db)


@router.get("/me")
def me(response: Response, user=Depends(require_user)):
    response.headers["Cache-Control"] = "no-store"
    return {"user": public_user(user)}


@router.post("/logout", dependencies=[Depends(csrf_guard)])
def logout(request: Request, response: Response, db=Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        db.sessions.delete_one({"_id": token_hash(token)})
    response.delete_cookie(COOKIE, path="/api", secure=settings.session_cookie_secure,
                           httponly=True, samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


def require_scanner_user(user=Depends(require_user)):
    if user.get("is_demo"):
        raise HTTPException(403, "This demo account is for sample data only. Use your own account for live scans.")
    return user

class ProfileInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    current_password: str | None = Field(default=None, max_length=256, repr=False)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Enter your full name.")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return str(value).lower()


@router.patch("/profile", dependencies=[Depends(csrf_guard)])
def update_profile(body: ProfileInput, request: Request, response: Response,
                   user=Depends(require_user), db=Depends(get_db)):
    if body.email != user["email"]:
        limit_attempts(request, user["email"], db)
        if not body.current_password or not verify_password(body.current_password, user["password_hash"]):
            raise HTTPException(400, "Enter your current password to change your email address.")
    try:
        updated = db.users.find_one_and_update(
            {"_id": user["_id"]},
            {"$set": {"name": body.name, "email": body.email, "updated_at": datetime.now(timezone.utc)}},
            return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        raise HTTPException(409, "That email address is already in use.") from None
    if updated is None:
        raise HTTPException(401, "Please sign in again.")
    response.headers["Cache-Control"] = "no-store"
    return {"user": public_user(updated)}


class PasswordInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=256, repr=False)
    new_password: str = Field(min_length=8, max_length=256, repr=False)

    @field_validator("new_password")
    @classmethod
    def bcrypt_length(cls, value):
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes (fewer characters for some languages).")
        return value


@router.patch("/password", dependencies=[Depends(csrf_guard)])
def change_password(body: PasswordInput, request: Request, response: Response,
                    user=Depends(require_user), db=Depends(get_db)):
    limit_attempts(request, user["email"], db)
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(400, "Your current password is incorrect.")
    if body.current_password == body.new_password:
        raise HTTPException(400, "Choose a new password different from your current password.")
    updated = db.users.find_one_and_update(
        {"_id": user["_id"], "password_hash": user["password_hash"]},
        {"$set": {"password_hash": password_hash(body.new_password), "updated_at": datetime.now(timezone.utc)},
         "$inc": {"password_version": 1}}, return_document=ReturnDocument.AFTER)
    if updated is None:
        raise HTTPException(409, "Your password has already changed. Please sign in again.")
    current = token_hash(request.cookies[COOKIE])
    db.sessions.update_one({"_id": current}, {"$set": {"password_version": updated["password_version"]}})
    db.sessions.delete_many({"user_id": user["_id"], "_id": {"$ne": current}})
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}
