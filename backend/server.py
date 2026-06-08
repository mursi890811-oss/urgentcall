"""UrgentCall backend - FastAPI + MongoDB."""
import os
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET_KEY"]
JWT_ALG = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_DAYS = int(os.environ.get("JWT_EXPIRES_DAYS", "30"))
EMERGENT_PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
EMERGENT_PUSH_BASE = "https://integrations.emergentagent.com"
EMERGENT_AUTH_BASE = "https://demobackend.emergentagent.com"

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

logger = logging.getLogger("urgentcall")
logging.basicConfig(level=logging.INFO)

push_client = httpx.AsyncClient(
    base_url=EMERGENT_PUSH_BASE,
    headers={"X-Push-Key": EMERGENT_PUSH_KEY},
    timeout=10.0,
)


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
    await db.push_tokens.create_index("user_id")
    yield
    client.close()
    await push_client.aclose()


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
    session_token: str  # from Emergent OAuth


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


async def send_push(recipients: List[str], data: dict):
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        return
    try:
        resp = await push_client.post(
            "/api/v1/push/trigger",
            json={"recipients": recipients, "data": data},
        )
        if resp.status_code >= 400:
            logger.warning(f"Push failed {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"Push exception (non-blocking): {e}")


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
    """Accepts session_id from Emergent OAuth flow, fetches user, creates/links account."""
    async with httpx.AsyncClient(timeout=10.0) as c:
        resp = await c.get(
            f"{EMERGENT_AUTH_BASE}/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_token},
        )
    if resp.status_code != 200:
        raise HTTPException(401, "Invalid Google session")
    data = resp.json()
    email = data["email"].lower()
    name = data.get("name", "")
    picture = data.get("picture")
    session_token = data["session_token"]

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

    await store_session(user["user_id"], session_token, "google")
    return TokenResp(access_token=session_token, user=user_public(user))


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
        "status": "sent",
        "created_at": utcnow(),
        "responded_at": None,
        "delivered": False,
    }
    await db.alerts.insert_one(alert)
    alert.pop("_id", None)

    # Send push (non-blocking)
    await send_push(
        recipients=[receiver["user_id"]],
        data={
            "title": "🚨 URGENT ALERT",
            "message": f"{user.get('full_name', 'Someone')} needs you urgently!",
            "action_url": f"/incoming-alert?alertId={alert['id']}",
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
    items = await db.alerts.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
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
    # Notify sender
    if body.action == "acknowledge":
        await send_push(
            recipients=[alert["sender_user_id"]],
            data={
                "title": "✅ Alert acknowledged",
                "message": f"{user.get('full_name', 'They')} responded: I'm OK",
            },
        )
    return {"ok": True, "status": new_status}


# ============ PUSH ============
@api.post("/register-push", status_code=201)
async def register_push(body: PushRegisterReq, user: dict = Depends(get_current_user)):
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
    # Relay to Emergent push service
    try:
        resp = await push_client.post(
            "/api/v1/push/users/register",
            json={
                "user_id": user["user_id"],
                "platform": body.platform,
                "device_token": body.device_token,
            },
        )
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Push register relay failed: {e}")
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
