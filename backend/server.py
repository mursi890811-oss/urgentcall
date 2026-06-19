"""UrgentCall backend - FastAPI + MongoDB."""
import os
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List

import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

import firebase_admin
from firebase_admin import credentials, messaging
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET_KEY"]
JWT_ALG = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_DAYS = int(os.environ.get("JWT_EXPIRES_DAYS", "30"))

# Firebase Admin SDK init (FCM push). Credentials come from either:
#  - FIREBASE_SERVICE_ACCOUNT_PATH: path to the downloaded service account json
#  - FIREBASE_SERVICE_ACCOUNT_JSON: the json contents directly (useful for some hosts)
GOOGLE_OAUTH_CLIENT_IDS = [
    c.strip() for c in os.environ.get("GOOGLE_OAUTH_CLIENT_IDS", "").split(",") if c.strip()
]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

logger = logging.getLogger("urgentcall")
logging.basicConfig(level=logging.INFO)

_firebase_app = None


def init_firebase():
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    sa_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH")
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    try:
        if sa_path and Path(sa_path).exists():
            cred = credentials.Certificate(sa_path)
        elif sa_json:
            cred = credentials.Certificate(json.loads(sa_json))
        else:
            logger.warning("No Firebase credentials configured - push notifications disabled.")
            return None
        _firebase_app = firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialized.")
        return _firebase_app
    except Exception as e:
        logger.error(f"Failed to init Firebase Admin SDK: {e}")
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("phone")
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.contacts.create_index([("owner_user_id", 1), ("phone", 1)])
    await db.alerts.create_index("receiver_user_id")
    await db.alerts.create_index("sender_user_id")
    await db.alerts.create_index("created_at")
    await db.alerts.create_index([("sender_user_id", 1), ("client_request_id", 1)])
    await db.push_tokens.create_index("user_id")
    init_firebase()
    yield
    client.close()


app = FastAPI(lifespan=lifespan)
api = APIRouter(prefix="/api")


# ============ MODELS ============
class RegisterReq(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=120)
    phone: str = Field(..., min_length=4, max_length=24)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class GoogleLoginReq(BaseModel):
    id_token: str  # Google Sign-In ID token from the client


class TokenResp(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ContactCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None


class ContactSearchReq(BaseModel):
    query: str  # phone or email


class AlertSendReq(BaseModel):
    receiver_user_id: str
    message: Optional[str] = None
    client_request_id: Optional[str] = None  # idempotency key - see send_alert()


class AlertRespondReq(BaseModel):
    action: str  # "acknowledge" | "dismiss"


class UpdateSettingsReq(BaseModel):
    override_silent: Optional[bool] = None
    vibration: Optional[bool] = None
    alert_sound: Optional[str] = None
    repeat_alert: Optional[bool] = None
    who_can_add: Optional[str] = None  # everyone | contacts | nobody


class UpdateProfileReq(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None


class PushRegisterReq(BaseModel):
    platform: str
    device_token: str


# ============ HELPERS ============
def utcnow():
    return datetime.now(timezone.utc)


def new_uid():
    return f"user_{uuid.uuid4().hex[:12]}"


def user_public(u: dict) -> dict:
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "full_name": u.get("full_name", ""),
        "phone": u.get("phone", ""),
        "avatar_url": u.get("avatar_url"),
        "provider": u.get("provider", "password"),
        "settings": u.get("settings", default_settings()),
    }


def default_settings():
    return {
        "override_silent": True,
        "vibration": True,
        "alert_sound": "default",
        "repeat_alert": True,
        "who_can_add": "everyone",
    }


def make_token(user_id: str) -> str:
    now = utcnow()
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=JWT_EXPIRES_DAYS)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def store_session(user_id: str, token: str, provider: str):
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "provider": provider,
        "created_at": utcnow(),
        "expires_at": utcnow() + timedelta(days=JWT_EXPIRES_DAYS),
    })


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = auth.split(" ", 1)[1].strip()

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        # Maybe it's a fresh JWT not yet stored (shouldn't happen) -> try decode
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            user_id = payload["sub"]
        except Exception:
            raise HTTPException(401, "Invalid token")
    else:
        exp = session.get("expires_at")
        if exp and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp and exp < utcnow():
            raise HTTPException(401, "Session expired")
        user_id = session["user_id"]

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


def _is_permanent_fcm_error(exc: Exception) -> bool:
    """True for errors where retrying is pointless (token is permanently invalid)."""
    msg = str(exc)
    return (
        isinstance(exc, messaging.UnregisteredError)
        or "registration-token-not-registered" in msg
        or "Requested entity was not found" in msg
    )


def _should_retry_fcm(exc: BaseException) -> bool:
    """Retry transient FCM/network errors, but never retry a permanently dead token."""
    if isinstance(exc, messaging.UnregisteredError):
        return False
    return isinstance(exc, Exception)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(_should_retry_fcm),
    reraise=True,
)
async def _fcm_send(token: str, data: dict):
    """Send one FCM data-only message. Retries transient/network failures; does not
    retry a permanently unregistered token, since that will never succeed."""
    message = messaging.Message(
        data={k: str(v) for k, v in data.items()},
        token=token,
        android=messaging.AndroidConfig(
            priority="high",  # wakes the device even if app is backgrounded/killed
            ttl=60,  # seconds - emergency alerts are useless if delayed too long
        ),
    )
    # messaging.send is sync; run it directly since calls are infrequent and fast.
    return messaging.send(message)


async def send_push(recipients: List[str], data: dict):
    """Send a high-priority FCM data message to all registered devices for each user_id.
    Non-blocking: failures are logged but never raise back to the caller, since a push
    failure should not prevent the alert itself from being recorded.
    """
    if not recipients or _firebase_app is None:
        if _firebase_app is None and recipients:
            logger.warning("Push skipped - Firebase not configured.")
        return
    tokens_cursor = db.push_tokens.find({"user_id": {"$in": recipients}}, {"_id": 0})
    tokens = await tokens_cursor.to_list(500)
    for t in tokens:
        device_token = t.get("device_token")
        if not device_token:
            continue
        try:
            await _fcm_send(device_token, data)
        except Exception as e:
            # Token is dead (app uninstalled, etc.) - clean it up so we stop retrying it forever.
            if _is_permanent_fcm_error(e):
                await db.push_tokens.delete_one({"user_id": t["user_id"], "platform": t.get("platform")})
                logger.info(f"Removed stale push token for user {t['user_id']}")
            else:
                logger.warning(f"FCM send failed after retries for user {t['user_id']}: {e}")


# ============ AUTH ============
@api.post("/auth/register", response_model=TokenResp)
async def register(body: RegisterReq):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")
    user_id = new_uid()
    user = {
        "user_id": user_id,
        "email": email,
        "phone": body.phone,
        "full_name": body.full_name,
        "password_hash": pwd_ctx.hash(body.password),
        "provider": "password",
        "settings": default_settings(),
        "blocked": [],
        "created_at": utcnow(),
    }
    await db.users.insert_one(user)
    token = make_token(user_id)
    await store_session(user_id, token, "password")
    return TokenResp(access_token=token, user=user_public(user))


@api.post("/auth/login", response_model=TokenResp)
async def login(body: LoginReq):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash"):
        raise HTTPException(401, "Invalid credentials")
    if not pwd_ctx.verify(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    token = make_token(user["user_id"])
    await store_session(user["user_id"], token, "password")
    return TokenResp(access_token=token, user=user_public(user))


@api.post("/auth/google", response_model=TokenResp)
async def google_login(body: GoogleLoginReq):
    """Verifies a real Google Sign-In ID token (issued client-side) and creates/links the account."""
    if not GOOGLE_OAUTH_CLIENT_IDS:
        raise HTTPException(500, "Google sign-in is not configured on the server")
    try:
        # verify_oauth2_token checks signature, expiry, and issuer against Google's public keys.
        idinfo = google_id_token.verify_oauth2_token(
            body.id_token, google_requests.Request()
        )
    except Exception:
        raise HTTPException(401, "Invalid Google token")

    if idinfo.get("aud") not in GOOGLE_OAUTH_CLIENT_IDS:
        raise HTTPException(401, "Token was not issued for this app")

    email = idinfo["email"].lower()
    name = idinfo.get("name", "")
    picture = idinfo.get("picture")

    user = await db.users.find_one({"email": email})
    if not user:
        user_id = new_uid()
        user = {
            "user_id": user_id,
            "email": email,
            "phone": "",
            "full_name": name,
            "avatar_url": picture,
            "provider": "google",
            "settings": default_settings(),
            "blocked": [],
            "created_at": utcnow(),
        }
        await db.users.insert_one(user)
    else:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"full_name": name, "avatar_url": picture}},
        )
        user["full_name"] = name
        user["avatar_url"] = picture

    token = make_token(user["user_id"])
    await store_session(user["user_id"], token, "google")
    return TokenResp(access_token=token, user=user_public(user))


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user_public(user)


@api.post("/auth/logout")
async def logout(request: Request, user: dict = Depends(get_current_user)):
    auth = request.headers.get("authorization", "")
    token = auth.split(" ", 1)[1].strip() if " " in auth else ""
    await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ============ PROFILE / SETTINGS ============
@api.patch("/users/me")
async def update_profile(body: UpdateProfileReq, user: dict = Depends(get_current_user)):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if update:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return user_public(u)


@api.patch("/users/me/settings")
async def update_settings(body: UpdateSettingsReq, user: dict = Depends(get_current_user)):
    settings_update = {f"settings.{k}": v for k, v in body.model_dump().items() if v is not None}
    if settings_update:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": settings_update})
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return user_public(u)


@api.get("/users/me/blocked")
async def list_blocked(user: dict = Depends(get_current_user)):
    blocked_ids = user.get("blocked") or []
    if not blocked_ids:
        return []
    users = await db.users.find(
        {"user_id": {"$in": blocked_ids}},
        {"_id": 0, "password_hash": 0},
    ).to_list(200)
    return [{"user_id": u["user_id"], "full_name": u.get("full_name", ""), "email": u.get("email", "")} for u in users]


@api.post("/users/me/blocked/{target_id}")
async def block_user(target_id: str, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$addToSet": {"blocked": target_id}})
    return {"ok": True}


@api.delete("/users/me/blocked/{target_id}")
async def unblock_user(target_id: str, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$pull": {"blocked": target_id}})
    return {"ok": True}


# ============ CONTACTS ============
@api.get("/contacts")
async def list_contacts(user: dict = Depends(get_current_user)):
    items = await db.contacts.find({"owner_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Lazily re-resolve invited contacts in case the person has since registered
    for c in items:
        if c.get("contact_user_id"):
            continue
        matched = None
        if c.get("email"):
            matched = await db.users.find_one({"email": c["email"].lower()}, {"_id": 0, "password_hash": 0})
        if not matched and c.get("phone"):
            # Try exact match first, then digits-only match
            phone_digits = "".join(ch for ch in c["phone"] if ch.isdigit())
            matched = await db.users.find_one({"phone": c["phone"]}, {"_id": 0, "password_hash": 0})
            if not matched and phone_digits:
                # last-7-digits suffix match to handle country code differences
                matched = await db.users.find_one(
                    {"phone": {"$regex": phone_digits[-7:] + "$"}},
                    {"_id": 0, "password_hash": 0},
                )
        if matched:
            c["contact_user_id"] = matched["user_id"]
            c["status"] = "active"
            c["avatar_url"] = matched.get("avatar_url")
            await db.contacts.update_one(
                {"id": c["id"]},
                {"$set": {
                    "contact_user_id": matched["user_id"],
                    "status": "active",
                    "avatar_url": matched.get("avatar_url"),
                }},
            )
    return items


@api.post("/contacts")
async def add_contact(body: ContactCreate, user: dict = Depends(get_current_user)):
    # Check if user with this phone/email exists in app
    matched_user = None
    if body.email:
        matched_user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0, "password_hash": 0})
    if not matched_user and body.phone:
        matched_user = await db.users.find_one({"phone": body.phone}, {"_id": 0, "password_hash": 0})

    contact = {
        "id": str(uuid.uuid4()),
        "owner_user_id": user["user_id"],
        "contact_user_id": matched_user["user_id"] if matched_user else None,
        "name": body.name,
        "phone": body.phone,
        "email": body.email,
        "avatar_url": matched_user.get("avatar_url") if matched_user else None,
        "status": "active" if matched_user else "invited",
        "created_at": utcnow(),
    }
    await db.contacts.insert_one(contact)
    contact.pop("_id", None)
    return contact


@api.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user: dict = Depends(get_current_user)):
    result = await db.contacts.delete_one({"id": contact_id, "owner_user_id": user["user_id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Contact not found")
    return {"ok": True}


@api.post("/users/search")
async def search_users(body: ContactSearchReq, user: dict = Depends(get_current_user)):
    q = body.query.strip().lower()
    found = await db.users.find_one(
        {"$or": [{"email": q}, {"phone": body.query.strip()}]},
        {"_id": 0, "password_hash": 0},
    )
    if not found:
        return {"found": False}
    return {"found": True, "user": user_public(found)}


# ============ ALERTS ============
@api.post("/alerts")
async def send_alert(body: AlertSendReq, user: dict = Depends(get_current_user)):
    # Idempotency: if the client already sent this exact request (e.g. its first attempt's
    # response was lost to a flaky connection and the client retried), return the original
    # alert instead of creating a second one. Without this, retry-on-network-failure logic
    # in the client could double-send an emergency alert.
    if body.client_request_id:
        existing = await db.alerts.find_one(
            {"sender_user_id": user["user_id"], "client_request_id": body.client_request_id},
            {"_id": 0},
        )
        if existing:
            return existing

    receiver = await db.users.find_one({"user_id": body.receiver_user_id}, {"_id": 0, "password_hash": 0})
    if not receiver:
        raise HTTPException(404, "Recipient not found")

    # Check receiver has sender in trusted contacts (or who_can_add policy)
    who_can_add = receiver.get("settings", {}).get("who_can_add", "everyone")
    is_trusted = await db.contacts.find_one({
        "owner_user_id": receiver["user_id"],
        "contact_user_id": user["user_id"],
    })
    if who_can_add == "nobody" and not is_trusted:
        raise HTTPException(403, "This person has not added you as a trusted contact")
    if who_can_add == "contacts" and not is_trusted:
        raise HTTPException(403, "This person has not added you as a trusted contact")

    # Check blocked
    if user["user_id"] in (receiver.get("blocked") or []):
        raise HTTPException(403, "You have been blocked by this user")

    alert = {
        "id": str(uuid.uuid4()),
        "sender_user_id": user["user_id"],
        "sender_name": user.get("full_name", ""),
        "sender_avatar": user.get("avatar_url"),
        "receiver_user_id": receiver["user_id"],
        "receiver_name": receiver.get("full_name", ""),
        "message": body.message or f"{user.get('full_name', 'Someone')} needs you urgently!",
        "client_request_id": body.client_request_id,
        "status": "sent",
        "created_at": utcnow(),
        "responded_at": None,
        "delivered": False,
    }
    await db.alerts.insert_one(alert)
    alert.pop("_id", None)

    # Send push (non-blocking, retried internally, never raises)
    await send_push(
        recipients=[receiver["user_id"]],
        data={
            "type": "incoming_alert",
            "alert_id": alert["id"],
            "sender_name": user.get("full_name", "Someone"),
            "message": alert["message"],
            "created_at": alert["created_at"].isoformat(),
        },
    )

    return alert


@api.get("/alerts")
async def list_alerts(filter: str = "all", user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    if filter == "sent":
        q = {"sender_user_id": uid}
    elif filter == "received":
        q = {"receiver_user_id": uid, "status": {"$in": ["sent", "received", "acknowledged"]}}
    elif filter == "missed":
        q = {"receiver_user_id": uid, "status": "missed"}
    else:
        q = {"$or": [{"sender_user_id": uid}, {"receiver_user_id": uid}]}
    items = await db.alerts.find(q, {"_id": 0}).sort([("created_at", -1)]).to_list(200)
    # add direction
    for it in items:
        it["direction"] = "outgoing" if it["sender_user_id"] == uid else "incoming"
    return items


@api.get("/alerts/pending")
async def pending_alerts(user: dict = Depends(get_current_user)):
    """Polling endpoint - returns alerts received in last 60 seconds not yet responded."""
    cutoff = utcnow() - timedelta(seconds=120)
    items = await db.alerts.find({
        "receiver_user_id": user["user_id"],
        "status": "sent",
        "created_at": {"$gte": cutoff},
    }, {"_id": 0}).sort("created_at", -1).to_list(10)
    return items


@api.post("/alerts/{alert_id}/respond")
async def respond_alert(alert_id: str, body: AlertRespondReq, user: dict = Depends(get_current_user)):
    alert = await db.alerts.find_one({"id": alert_id, "receiver_user_id": user["user_id"]})
    if not alert:
        raise HTTPException(404, "Alert not found")
    new_status = "acknowledged" if body.action == "acknowledge" else "dismissed"
    await db.alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": new_status, "responded_at": utcnow()}},
    )
    # Notify sender either way, so they always know the alarm stopped on the receiver's end.
    await send_push(
        recipients=[alert["sender_user_id"]],
        data={
            "type": "alert_response",
            "alert_id": alert_id,
            "status": new_status,
            "responder_name": user.get("full_name", "They"),
        },
    )
    return {"ok": True, "status": new_status}


@api.get("/alerts/{alert_id}")
async def get_alert(alert_id: str, user: dict = Depends(get_current_user)):
    """Sender or receiver polls a specific alert to see its current status."""
    alert = await db.alerts.find_one(
        {
            "id": alert_id,
            "$or": [
                {"sender_user_id": user["user_id"]},
                {"receiver_user_id": user["user_id"]},
            ],
        },
        {"_id": 0},
    )
    if not alert:
        raise HTTPException(404, "Alert not found")
    return alert


# ============ PUSH ============
@api.post("/register-push", status_code=201)
async def register_push(body: PushRegisterReq, user: dict = Depends(get_current_user)):
    """Stores the device's FCM token so we can send it push notifications directly."""
    await db.push_tokens.update_one(
        {"user_id": user["user_id"], "platform": body.platform},
        {"$set": {
            "user_id": user["user_id"],
            "platform": body.platform,
            "device_token": body.device_token,
            "updated_at": utcnow(),
        }},
        upsert=True,
    )
    return {"status": "registered"}


@api.get("/")
async def root():
    return {"app": "UrgentCall", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
