"""Auth & role-based access tests for Stock Eventos."""
import os
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "iantecnicosonido@gmail.com", "password": "EdisonBryan2026!"}

TS = str(int(time.time()))
TECNICO = {"email": f"tecnico_{TS}@test.com", "password": "Test1234!", "name": "Tec Test", "role": "tecnico"}
ALMACEN = {"email": f"warehouse_{TS}@test.com", "password": "Test1234!", "name": "Alm Test", "role": "almacen"}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# Module-level state for sharing tokens & ids between tests
state = {}


# ---------- Auth basics ----------
def test_login_admin_success():
    r = _login(**ADMIN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "access_token" in d and isinstance(d["access_token"], str) and len(d["access_token"]) > 20
    assert d["user"]["email"] == ADMIN["email"]
    assert d["user"]["role"] == "productor"
    assert d["user"]["active"] is True
    state["admin_token"] = d["access_token"]
    state["admin_id"] = d["user"]["id"]


def test_login_invalid_credentials():
    r = _login(ADMIN["email"], "WrongPass1!")
    assert r.status_code == 401


def test_me_without_token():
    r = requests.get(f"{API}/auth/me", timeout=10)
    assert r.status_code == 401


def test_me_with_bearer():
    r = requests.get(f"{API}/auth/me", headers=_bearer(state["admin_token"]), timeout=10)
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN["email"]
    assert r.json()["role"] == "productor"


# ---------- Events: auth required, full list for productor ----------
def test_events_no_auth_401():
    r = requests.get(f"{API}/events", timeout=10)
    assert r.status_code == 401


def test_events_productor_full_list():
    r = requests.get(f"{API}/events", headers=_bearer(state["admin_token"]), timeout=15)
    assert r.status_code == 200
    events = r.json()
    assert isinstance(events, list)
    assert len(events) >= 1
    state["events"] = events


# ---------- User creation (productor) ----------
def _create_user_or_get(payload):
    """Idempotent: create user; if 400 (already exists), return existing id via login."""
    r = requests.post(f"{API}/users", json=payload, headers=_bearer(state["admin_token"]), timeout=10)
    if r.status_code == 200:
        return r.json()
    if r.status_code == 400 and "existe" in r.text.lower():
        lr = _login(payload["email"], payload["password"])
        if lr.status_code == 200:
            return lr.json()["user"]
    pytest.fail(f"Could not create user {payload['email']}: {r.status_code} {r.text}")


def test_create_tecnico_and_almacen():
    tec = _create_user_or_get(TECNICO)
    alm = _create_user_or_get(ALMACEN)
    assert tec["role"] == "tecnico"
    assert alm["role"] == "almacen"
    state["tec_id"] = tec["id"]
    state["alm_id"] = alm["id"]
    # login both to get tokens
    r = _login(TECNICO["email"], TECNICO["password"])
    assert r.status_code == 200, r.text
    state["tec_token"] = r.json()["access_token"]
    r = _login(ALMACEN["email"], ALMACEN["password"])
    assert r.status_code == 200, r.text
    state["alm_token"] = r.json()["access_token"]


# ---------- Tecnico sees only assigned events ----------
def test_tecnico_sees_only_assigned():
    r = requests.get(f"{API}/events", headers=_bearer(state["tec_token"]), timeout=10)
    assert r.status_code == 200
    # Initially tec is not assigned to anything (might be 0 if fresh; or N>=0 if already assigned)
    initial = r.json()
    state["tec_initial_count"] = len(initial)


def test_assign_tecnico_then_tecnico_sees_event():
    # Pick first event
    eid = state["events"][0]["id"]
    state["assigned_eid"] = eid
    current = state["events"][0].get("assigned_technicians") or []
    new = list(set(current + [state["tec_id"]]))
    r = requests.put(f"{API}/events/{eid}", json={"assigned_technicians": new},
                     headers=_bearer(state["admin_token"]), timeout=10)
    assert r.status_code == 200, r.text
    assert state["tec_id"] in r.json()["assigned_technicians"]

    # tec must see it now
    r = requests.get(f"{API}/events", headers=_bearer(state["tec_token"]), timeout=10)
    assert r.status_code == 200
    ids = [e["id"] for e in r.json()]
    assert eid in ids


# ---------- Tecnico restrictions ----------
def test_tecnico_cannot_create_event():
    r = requests.post(f"{API}/events", json={"name": "TEST_NoTec"},
                      headers=_bearer(state["tec_token"]), timeout=10)
    assert r.status_code == 403


def test_tecnico_cannot_block_material():
    eid = state["assigned_eid"]
    r = requests.post(f"{API}/events/{eid}/materials",
                      json={"material_id": "fake", "quantity": 1},
                      headers=_bearer(state["tec_token"]), timeout=10)
    assert r.status_code == 403


def test_tecnico_can_export_assigned_event():
    eid = state["assigned_eid"]
    r = requests.get(f"{API}/events/{eid}/export",
                     headers=_bearer(state["tec_token"]), timeout=20)
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"


def test_tecnico_cannot_export_unassigned_event():
    # find an event the tec is NOT assigned to
    other = next((e for e in state["events"] if e["id"] != state["assigned_eid"]), None)
    if not other:
        pytest.skip("No other event")
    r = requests.get(f"{API}/events/{other['id']}/export",
                     headers=_bearer(state["tec_token"]), timeout=20)
    assert r.status_code == 403


def test_tecnico_can_create_incident():
    # need a valid unit_id
    r = requests.get(f"{API}/units", headers=_bearer(state["admin_token"]), timeout=15)
    assert r.status_code == 200
    units = r.json()
    if not units:
        pytest.skip("No units in inventory")
    uid = units[0]["id"]
    r = requests.post(f"{API}/incidents",
                      json={"unit_id": uid, "type": "rotura", "description": "TEST_inc auth"},
                      headers=_bearer(state["tec_token"]), timeout=10)
    assert r.status_code == 200, r.text


# ---------- Almacen permissions ----------
def test_almacen_can_block_material():
    # use a material with stock
    r = requests.get(f"{API}/materials", headers=_bearer(state["alm_token"]), timeout=15)
    mats = [m for m in r.json() if (m.get("quantity", 0) - m.get("blocked", 0)) > 0]
    assert mats, "Need an available material"
    mid = mats[0]["id"]
    eid = state["assigned_eid"]
    r = requests.post(f"{API}/events/{eid}/materials",
                      json={"material_id": mid, "quantity": 1},
                      headers=_bearer(state["alm_token"]), timeout=10)
    assert r.status_code == 200, r.text
    state["blocked_mid"] = mid


def test_almacen_cannot_edit_event_ficha():
    eid = state["assigned_eid"]
    r = requests.put(f"{API}/events/{eid}", json={"name": "NoDeberíaCambiar"},
                     headers=_bearer(state["alm_token"]), timeout=10)
    assert r.status_code == 403


def test_almacen_cannot_create_event():
    r = requests.post(f"{API}/events", json={"name": "TEST_NoAlm"},
                      headers=_bearer(state["alm_token"]), timeout=10)
    assert r.status_code == 403


def test_almacen_close_then_reopen():
    eid = state["assigned_eid"]
    r = requests.post(f"{API}/events/{eid}/close",
                      headers=_bearer(state["alm_token"]), timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cerrado"
    r = requests.post(f"{API}/events/{eid}/reopen",
                      headers=_bearer(state["alm_token"]), timeout=10)
    assert r.status_code == 200
    assert r.json()["status"] == "abierto"


def test_almacen_cannot_manage_users():
    r = requests.post(f"{API}/users",
                      json={"email": "x@x.com", "password": "Test1234!", "name": "x", "role": "tecnico"},
                      headers=_bearer(state["alm_token"]), timeout=10)
    assert r.status_code == 403


# ---------- Password flows ----------
def test_forgot_password_returns_200():
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": ADMIN["email"]}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_forgot_password_unknown_email_returns_200():
    r = requests.post(f"{API}/auth/forgot-password",
                      json={"email": "nobody_xyz@example.com"}, timeout=10)
    assert r.status_code == 200


def test_change_password_wrong_old_fails():
    r = requests.post(f"{API}/auth/change-password",
                      json={"old_password": "WrongOldXXX!", "new_password": "BrandNew1234!"},
                      headers=_bearer(state["tec_token"]), timeout=10)
    assert r.status_code == 400


def test_change_password_correct_then_revert():
    r = requests.post(f"{API}/auth/change-password",
                      json={"old_password": TECNICO["password"], "new_password": "NewPwd1234!"},
                      headers=_bearer(state["tec_token"]), timeout=10)
    assert r.status_code == 200
    # revert
    rl = _login(TECNICO["email"], "NewPwd1234!")
    assert rl.status_code == 200
    new_token = rl.json()["access_token"]
    r = requests.post(f"{API}/auth/change-password",
                      json={"old_password": "NewPwd1234!", "new_password": TECNICO["password"]},
                      headers=_bearer(new_token), timeout=10)
    assert r.status_code == 200


# ---------- Cleanup ----------
def test_zz_cleanup_revert_assignments_and_delete_users():
    # Unblock material
    if state.get("blocked_mid"):
        requests.delete(f"{API}/events/{state['assigned_eid']}/materials/{state['blocked_mid']}",
                        headers=_bearer(state["admin_token"]), timeout=10)
    # Remove tec from event assignments
    eid = state.get("assigned_eid")
    if eid:
        r = requests.get(f"{API}/events/{eid}", headers=_bearer(state["admin_token"]), timeout=10)
        if r.status_code == 200:
            current = r.json().get("assigned_technicians") or []
            cleaned = [t for t in current if t != state.get("tec_id")]
            requests.put(f"{API}/events/{eid}", json={"assigned_technicians": cleaned},
                         headers=_bearer(state["admin_token"]), timeout=10)
    # Delete test users
    for uid in (state.get("tec_id"), state.get("alm_id")):
        if uid:
            requests.delete(f"{API}/users/{uid}", headers=_bearer(state["admin_token"]), timeout=10)
