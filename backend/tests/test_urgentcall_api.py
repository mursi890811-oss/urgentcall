"""UrgentCall backend API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://alert-bypass.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@test.com", "password": "password123"}
BOB = {"email": "bob@test.com", "password": "password123"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _ensure_user(s, email, password, full_name, phone):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json()
    r = s.post(f"{API}/auth/register", json={
        "email": email, "password": password, "full_name": full_name, "phone": phone
    })
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def alice_auth(session):
    data = _ensure_user(session, ALICE["email"], ALICE["password"], "Alice Tester", "+15550001")
    return data


@pytest.fixture(scope="module")
def bob_auth(session):
    data = _ensure_user(session, BOB["email"], BOB["password"], "Bob Friend", "+15550002")
    return data


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth ----------
class TestAuth:
    def test_register_new_user(self, session):
        uniq = uuid.uuid4().hex[:8]
        body = {
            "full_name": f"TEST User {uniq}",
            "phone": f"+1555{uniq[:7]}",
            "email": f"test_{uniq}@example.com",
            "password": "password123",
        }
        r = session.post(f"{API}/auth/register", json=body)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "access_token" in j and j["user"]["email"] == body["email"]

    def test_login_success(self, session, alice_auth):
        r = session.post(f"{API}/auth/login", json=ALICE)
        assert r.status_code == 200
        j = r.json()
        assert "access_token" in j
        assert j["user"]["email"] == "alice@test.com"

    def test_login_wrong_password(self, session):
        r = session.post(f"{API}/auth/login", json={"email": "alice@test.com", "password": "WRONG"})
        assert r.status_code == 401

    def test_me_with_token(self, session, alice_auth):
        r = session.get(f"{API}/auth/me", headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        j = r.json()
        for k in ("user_id", "email", "full_name", "settings"):
            assert k in j

    def test_me_without_token(self, session):
        r = session.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------- User search & contacts ----------
class TestContactsFlow:
    def test_search_user_found(self, session, alice_auth, bob_auth):
        r = session.post(f"{API}/users/search",
                         json={"query": "bob@test.com"},
                         headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        j = r.json()
        assert j.get("found") is True
        assert j["user"]["email"] == "bob@test.com"

    def test_search_user_not_found(self, session, alice_auth):
        r = session.post(f"{API}/users/search",
                         json={"query": "nobody_xyz@nowhere.com"},
                         headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        assert r.json().get("found") is False

    def test_add_contact_active(self, session, alice_auth, bob_auth):
        # add bob to alice's contacts
        body = {"name": "Bob Friend", "phone": bob_auth["user"]["phone"], "email": "bob@test.com"}
        r = session.post(f"{API}/contacts", json=body, headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        c = r.json()
        assert c["status"] == "active"
        assert c["contact_user_id"] == bob_auth["user"]["user_id"]
        pytest.alice_contact_id = c["id"]

    def test_list_contacts(self, session, alice_auth):
        r = session.get(f"{API}/contacts", headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert any(c.get("email") == "bob@test.com" for c in items)

    def test_add_alice_as_bobs_contact(self, session, alice_auth, bob_auth):
        # so alert from bob->alice passes who_can_add policy regardless
        body = {"name": "Alice Tester", "phone": alice_auth["user"]["phone"], "email": "alice@test.com"}
        r = session.post(f"{API}/contacts", json=body, headers=H(bob_auth["access_token"]))
        assert r.status_code == 200


# ---------- Alerts ----------
class TestAlertsFlow:
    def test_send_alert_bob_to_alice(self, session, alice_auth, bob_auth):
        body = {"receiver_user_id": alice_auth["user"]["user_id"], "message": "TEST urgent!"}
        r = session.post(f"{API}/alerts", json=body, headers=H(bob_auth["access_token"]))
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["sender_user_id"] == bob_auth["user"]["user_id"]
        assert a["receiver_user_id"] == alice_auth["user"]["user_id"]
        assert a["status"] == "sent"
        pytest.alert_id = a["id"]

    def test_pending_alerts_alice(self, session, alice_auth):
        r = session.get(f"{API}/alerts/pending", headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        items = r.json()
        assert any(it["id"] == pytest.alert_id for it in items)

    def test_respond_acknowledge(self, session, alice_auth):
        r = session.post(f"{API}/alerts/{pytest.alert_id}/respond",
                         json={"action": "acknowledge"},
                         headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        assert r.json()["status"] == "acknowledged"

    def test_list_alerts_all_with_direction(self, session, alice_auth):
        r = session.get(f"{API}/alerts?filter=all", headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert all("direction" in it for it in items)
        target = next((it for it in items if it["id"] == pytest.alert_id), None)
        assert target is not None
        assert target["direction"] == "incoming"

    def test_send_alert_invalid_receiver(self, session, bob_auth):
        r = session.post(f"{API}/alerts",
                         json={"receiver_user_id": "user_doesnotexist"},
                         headers=H(bob_auth["access_token"]))
        assert r.status_code == 404


# ---------- Settings ----------
class TestSettings:
    def test_update_settings_vibration(self, session, alice_auth):
        r = session.patch(f"{API}/users/me/settings",
                          json={"vibration": False},
                          headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        assert r.json()["settings"]["vibration"] is False
        # reset
        session.patch(f"{API}/users/me/settings",
                      json={"vibration": True},
                      headers=H(alice_auth["access_token"]))


# ---------- Cleanup contact ----------
class TestCleanup:
    def test_delete_contact(self, session, alice_auth):
        cid = getattr(pytest, "alice_contact_id", None)
        if not cid:
            pytest.skip("no contact created")
        r = session.delete(f"{API}/contacts/{cid}", headers=H(alice_auth["access_token"]))
        assert r.status_code == 200
        # verify gone
        r = session.get(f"{API}/contacts", headers=H(alice_auth["access_token"]))
        assert not any(c["id"] == cid for c in r.json())
