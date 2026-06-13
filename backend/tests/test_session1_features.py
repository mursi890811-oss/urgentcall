"""Tests for Session 1 features:
- POST /api/alerts with optional `message`
- GET /api/alerts sorted newest-first across all filters
- GET /api/alerts/{alert_id} (sender OR receiver; non-participant -> 404)
- Existing pending + respond + status updates flow
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://alert-bypass.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@test.com", "password": "password123"}
BOB = {"email": "bob@test.com", "password": "password123"}


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _ensure(s, email, password, name, phone):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json()
    r = s.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "full_name": name, "phone": phone},
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def alice(session):
    return _ensure(session, ALICE["email"], ALICE["password"], "Alice Tester", "+15550001")


@pytest.fixture(scope="module")
def bob(session):
    return _ensure(session, BOB["email"], BOB["password"], "Bob Friend", "+15550002")


@pytest.fixture(scope="module")
def carol(session):
    # Third-party participant for negative test on GET /alerts/{id}
    uniq = uuid.uuid4().hex[:8]
    return _ensure(
        session,
        f"carol_{uniq}@test.com",
        "password123",
        "Carol Stranger",
        f"+1555{uniq[:7]}",
    )


# ---------- Custom Message ----------
class TestCustomMessage:
    def test_send_alert_with_custom_message(self, session, alice, bob):
        msg = "TEST_msg I need you now"
        r = session.post(
            f"{API}/alerts",
            json={"receiver_user_id": alice["user"]["user_id"], "message": msg},
            headers=H(bob["access_token"]),
        )
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["message"] == msg
        pytest.s1_alert_with_msg = a["id"]

    def test_send_alert_without_message_uses_default(self, session, alice, bob):
        r = session.post(
            f"{API}/alerts",
            json={"receiver_user_id": alice["user"]["user_id"]},
            headers=H(bob["access_token"]),
        )
        assert r.status_code == 200, r.text
        a = r.json()
        # default = "<sender_name> needs you urgently!"
        assert isinstance(a["message"], str) and len(a["message"]) > 0
        assert "urgently" in a["message"].lower()
        pytest.s1_alert_default_msg = a["id"]

    def test_custom_message_persists_on_get(self, session, alice):
        # Receiver fetches the alert via new GET /api/alerts/{id}
        aid = pytest.s1_alert_with_msg
        r = session.get(f"{API}/alerts/{aid}", headers=H(alice["access_token"]))
        assert r.status_code == 200, r.text
        assert r.json()["message"] == "TEST_msg I need you now"


# ---------- Sorted newest-first ----------
class TestAlertsSortedNewestFirst:
    def test_list_alerts_all_sorted_desc(self, session, alice):
        r = session.get(f"{API}/alerts?filter=all", headers=H(alice["access_token"]))
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        created = [it["created_at"] for it in items]
        # ISO strings sort lexicographically the same as chronological
        assert created == sorted(created, reverse=True), f"Not sorted desc: {created}"

    def test_list_alerts_received_sorted_desc(self, session, alice):
        r = session.get(f"{API}/alerts?filter=received", headers=H(alice["access_token"]))
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        created = [it["created_at"] for it in items]
        assert created == sorted(created, reverse=True)

    def test_list_alerts_sent_sorted_desc(self, session, bob):
        r = session.get(f"{API}/alerts?filter=sent", headers=H(bob["access_token"]))
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        created = [it["created_at"] for it in items]
        assert created == sorted(created, reverse=True)


# ---------- GET /api/alerts/{alert_id} ----------
class TestGetSingleAlert:
    def test_sender_can_fetch(self, session, bob):
        aid = pytest.s1_alert_with_msg
        r = session.get(f"{API}/alerts/{aid}", headers=H(bob["access_token"]))
        assert r.status_code == 200
        assert r.json()["id"] == aid

    def test_receiver_can_fetch(self, session, alice):
        aid = pytest.s1_alert_with_msg
        r = session.get(f"{API}/alerts/{aid}", headers=H(alice["access_token"]))
        assert r.status_code == 200
        assert r.json()["id"] == aid

    def test_non_participant_gets_404(self, session, carol):
        aid = pytest.s1_alert_with_msg
        r = session.get(f"{API}/alerts/{aid}", headers=H(carol["access_token"]))
        assert r.status_code == 404

    def test_unauthenticated_gets_401(self, session):
        aid = pytest.s1_alert_with_msg
        r = session.get(f"{API}/alerts/{aid}")
        assert r.status_code == 401

    def test_unknown_id_returns_404(self, session, alice):
        r = session.get(f"{API}/alerts/no-such-id-{uuid.uuid4()}", headers=H(alice["access_token"]))
        assert r.status_code == 404

    def test_pending_endpoint_not_shadowed(self, session, alice):
        """Ensure GET /alerts/pending still works (not shadowed by /alerts/{id})."""
        r = session.get(f"{API}/alerts/pending", headers=H(alice["access_token"]))
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)


# ---------- End-to-end acknowledge flow visible via GET /alerts/{id} ----------
class TestAckPropagatesToGetSingle:
    def test_full_ack_flow(self, session, alice, bob):
        # 1. Bob -> Alice
        msg = "TEST_ack flow message"
        r = session.post(
            f"{API}/alerts",
            json={"receiver_user_id": alice["user"]["user_id"], "message": msg},
            headers=H(bob["access_token"]),
        )
        assert r.status_code == 200
        a = r.json()
        aid = a["id"]
        assert a["status"] == "sent"

        # 2. Sender (Bob) sees status=sent via GET /alerts/{id}
        r = session.get(f"{API}/alerts/{aid}", headers=H(bob["access_token"]))
        assert r.status_code == 200
        assert r.json()["status"] == "sent"
        assert r.json()["message"] == msg

        # 3. Pending list for Alice includes this alert
        r = session.get(f"{API}/alerts/pending", headers=H(alice["access_token"]))
        assert r.status_code == 200
        assert any(it["id"] == aid for it in r.json())

        # 4. Alice acknowledges
        r = session.post(
            f"{API}/alerts/{aid}/respond",
            json={"action": "acknowledge"},
            headers=H(alice["access_token"]),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "acknowledged"

        # 5. Sender polls GET /alerts/{id} -> now acknowledged
        r = session.get(f"{API}/alerts/{aid}", headers=H(bob["access_token"]))
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "acknowledged"
        assert body["responded_at"] is not None

    def test_dismiss_flow(self, session, alice, bob):
        r = session.post(
            f"{API}/alerts",
            json={"receiver_user_id": alice["user"]["user_id"], "message": "TEST dismiss"},
            headers=H(bob["access_token"]),
        )
        assert r.status_code == 200
        aid = r.json()["id"]
        r = session.post(
            f"{API}/alerts/{aid}/respond",
            json={"action": "dismiss"},
            headers=H(alice["access_token"]),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "dismissed"
        # sender sees dismissed
        r = session.get(f"{API}/alerts/{aid}", headers=H(bob["access_token"]))
        assert r.status_code == 200
        assert r.json()["status"] == "dismissed"
