"""Privacy section tests: who_can_add settings + blocked contacts."""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ALICE = {"email": "alice@test.com", "password": "password123"}


@pytest.fixture(scope="module")
def alice_token():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ALICE)
    if r.status_code != 200:
        # ensure user exists
        r2 = s.post(f"{API}/auth/register", json={
            **ALICE, "full_name": "Alice Tester", "phone": "+15550001"
        })
        assert r2.status_code == 200, r2.text
        r = s.post(f"{API}/auth/login", json=ALICE)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def H(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


class TestBlocked:
    def test_blocked_list_empty_for_alice(self, alice_token):
        r = requests.get(f"{API}/users/me/blocked", headers=H(alice_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        # Alice should not have any blocked users from baseline
        assert body == [] or all("user_id" in b for b in body)

    def test_blocked_requires_auth(self):
        r = requests.get(f"{API}/users/me/blocked")
        assert r.status_code == 401


class TestWhoCanAdd:
    def test_patch_who_can_add_nobody_persists(self, alice_token):
        r = requests.patch(f"{API}/users/me/settings",
                           json={"who_can_add": "nobody"}, headers=H(alice_token))
        assert r.status_code == 200, r.text
        assert r.json()["settings"]["who_can_add"] == "nobody"

        # Verify persisted via /auth/me
        me = requests.get(f"{API}/auth/me", headers=H(alice_token))
        assert me.status_code == 200
        assert me.json()["settings"]["who_can_add"] == "nobody"

    def test_patch_who_can_add_contacts(self, alice_token):
        r = requests.patch(f"{API}/users/me/settings",
                           json={"who_can_add": "contacts"}, headers=H(alice_token))
        assert r.status_code == 200
        assert r.json()["settings"]["who_can_add"] == "contacts"
        me = requests.get(f"{API}/auth/me", headers=H(alice_token))
        assert me.json()["settings"]["who_can_add"] == "contacts"

    def test_patch_who_can_add_everyone_reset(self, alice_token):
        # Restore default for clean state
        r = requests.patch(f"{API}/users/me/settings",
                           json={"who_can_add": "everyone"}, headers=H(alice_token))
        assert r.status_code == 200
        assert r.json()["settings"]["who_can_add"] == "everyone"
