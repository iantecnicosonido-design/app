"""Tests for Contabilidad (Accounting) endpoints on bolo/alquiler events.

Covers:
- POST/DELETE /api/events/{eid}/extra-accounting
- PATCH /api/events/{eid}/budget-amount and /invoice-amount
- RBAC enforcement (productor only on POST/DELETE/PATCH)
- _scrub_invoices: extra_accounting hidden for almacen/taller/tecnico
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://material-calendar.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EVENT_ID = "c90536c0-2a70-4a1e-ab54-513a63fb477f"  # 'La Grand Band'

CREDS = {
    "productor": {"email": "Admin", "password": "Admin"},
    "almacen":   {"email": "Almacen", "password": "Almacen"},
    "taller":    {"email": "Taller", "password": "Taller"},
    "tecnico":   {"email": "ianedisonrent@gmail.com", "password": "TempPass2026!"},
}


def _login(role):
    r = requests.post(f"{API}/auth/login", json=CREDS[role], timeout=30)
    assert r.status_code == 200, f"login {role} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {role: _login(role) for role in CREDS}


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- GET /events/{eid} scrubbing ----------
def test_productor_sees_extra_accounting_array(tokens):
    r = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "extra_accounting" in data
    assert isinstance(data["extra_accounting"], list)


@pytest.mark.parametrize("role", ["almacen", "taller", "tecnico"])
def test_non_productor_extra_accounting_scrubbed(tokens, role):
    r = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens[role]), timeout=30)
    # tecnico may get 403 if not assigned; accept that or check field is empty
    if r.status_code == 403:
        pytest.skip(f"{role} cannot view event (not assigned) — RBAC ok")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("extra_accounting") == [], f"{role} should NOT see extra_accounting; got {data.get('extra_accounting')}"
    assert data.get("event_budget") in (None, {}), f"{role} should not see event_budget"
    assert data.get("event_invoice") in (None, {}), f"{role} should not see event_invoice"


# ---------- POST /extra-accounting ----------
@pytest.fixture
def created_extra(tokens):
    payload = {"kind": "gasto", "concept": "TEST_pytest concept", "amount_excl_iva": 100.0, "iva_pct": 21.0}
    r = requests.post(f"{API}/events/{EVENT_ID}/extra-accounting",
                      headers=H(tokens["productor"]), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    entry = r.json()
    yield entry
    # cleanup
    requests.delete(f"{API}/events/{EVENT_ID}/extra-accounting/{entry['id']}",
                    headers=H(tokens["productor"]), timeout=30)


def test_create_extra_computes_total_with_iva(created_extra):
    assert created_extra["kind"] == "gasto"
    assert created_extra["concept"] == "TEST_pytest concept"
    assert created_extra["amount_excl_iva"] == 100.0
    assert created_extra["iva_pct"] == 21.0
    # 100 * 1.21 = 121.0
    assert created_extra["total_incl_iva"] == 121.0
    assert "id" in created_extra


def test_extra_appears_in_event(tokens, created_extra):
    r = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
    assert r.status_code == 200
    ids = [e["id"] for e in r.json().get("extra_accounting", [])]
    assert created_extra["id"] in ids


def test_create_extra_empty_concept_400(tokens):
    payload = {"kind": "ingreso", "concept": "   ", "amount_excl_iva": 50, "iva_pct": 10}
    r = requests.post(f"{API}/events/{EVENT_ID}/extra-accounting",
                      headers=H(tokens["productor"]), json=payload, timeout=30)
    assert r.status_code == 400, r.text


def test_create_extra_invalid_kind_422(tokens):
    payload = {"kind": "otro", "concept": "x", "amount_excl_iva": 10, "iva_pct": 21}
    r = requests.post(f"{API}/events/{EVENT_ID}/extra-accounting",
                      headers=H(tokens["productor"]), json=payload, timeout=30)
    assert r.status_code in (400, 422), r.text


# ---------- DELETE /extra-accounting/{rid} ----------
def test_delete_extra_removes(tokens):
    # create
    payload = {"kind": "ingreso", "concept": "TEST_to_delete", "amount_excl_iva": 33.0, "iva_pct": 21.0}
    r = requests.post(f"{API}/events/{EVENT_ID}/extra-accounting",
                      headers=H(tokens["productor"]), json=payload, timeout=30)
    assert r.status_code == 200
    rid = r.json()["id"]
    # delete
    rd = requests.delete(f"{API}/events/{EVENT_ID}/extra-accounting/{rid}",
                         headers=H(tokens["productor"]), timeout=30)
    assert rd.status_code == 200, rd.text
    # verify gone
    rg = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
    ids = [e["id"] for e in rg.json().get("extra_accounting", [])]
    assert rid not in ids


# ---------- RBAC on accounting endpoints ----------
@pytest.mark.parametrize("role", ["almacen", "taller", "tecnico"])
def test_rbac_post_extra_403(tokens, role):
    payload = {"kind": "gasto", "concept": "x", "amount_excl_iva": 1.0, "iva_pct": 21.0}
    r = requests.post(f"{API}/events/{EVENT_ID}/extra-accounting",
                      headers=H(tokens[role]), json=payload, timeout=30)
    assert r.status_code == 403, f"{role}: {r.status_code} {r.text}"


@pytest.mark.parametrize("role", ["almacen", "taller", "tecnico"])
def test_rbac_delete_extra_403(tokens, role):
    fake_rid = "00000000-0000-0000-0000-000000000000"
    r = requests.delete(f"{API}/events/{EVENT_ID}/extra-accounting/{fake_rid}",
                        headers=H(tokens[role]), timeout=30)
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["almacen", "taller", "tecnico"])
def test_rbac_patch_budget_amount_403(tokens, role):
    r = requests.patch(f"{API}/events/{EVENT_ID}/budget-amount",
                       headers=H(tokens[role]), json={"amount_excl_iva": 1, "iva_pct": 21}, timeout=30)
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["almacen", "taller", "tecnico"])
def test_rbac_patch_invoice_amount_403(tokens, role):
    r = requests.patch(f"{API}/events/{EVENT_ID}/invoice-amount",
                       headers=H(tokens[role]), json={"amount_excl_iva": 1, "iva_pct": 21}, timeout=30)
    assert r.status_code == 403


# ---------- PATCH budget/invoice 404 when no file uploaded ----------
def test_patch_budget_amount_behavior(tokens):
    """If no budget uploaded -> 404; if uploaded -> 200 and persisted."""
    r0 = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
    has_budget = bool(r0.json().get("event_budget"))
    r = requests.patch(f"{API}/events/{EVENT_ID}/budget-amount",
                       headers=H(tokens["productor"]),
                       json={"amount_excl_iva": 555.55, "iva_pct": 10.0}, timeout=30)
    if not has_budget:
        assert r.status_code == 404, r.text
    else:
        assert r.status_code == 200, r.text
        # Verify persisted
        rg = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
        b = rg.json().get("event_budget") or {}
        assert b.get("amount_excl_iva") == 555.55
        assert b.get("iva_pct") == 10.0


def test_patch_invoice_amount_behavior(tokens):
    r0 = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
    has_invoice = bool(r0.json().get("event_invoice"))
    r = requests.patch(f"{API}/events/{EVENT_ID}/invoice-amount",
                       headers=H(tokens["productor"]),
                       json={"amount_excl_iva": 777.77, "iva_pct": 4.0}, timeout=30)
    if not has_invoice:
        assert r.status_code == 404, r.text
    else:
        assert r.status_code == 200, r.text
        rg = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
        inv = rg.json().get("event_invoice") or {}
        assert inv.get("amount_excl_iva") == 777.77
        assert inv.get("iva_pct") == 4.0


# ---------- ZZ Cleanup ----------
def test_zz_cleanup(tokens):
    """Remove any TEST_pytest extras left over."""
    r = requests.get(f"{API}/events/{EVENT_ID}", headers=H(tokens["productor"]), timeout=30)
    for e in r.json().get("extra_accounting", []):
        if (e.get("concept") or "").startswith("TEST_"):
            requests.delete(f"{API}/events/{EVENT_ID}/extra-accounting/{e['id']}",
                            headers=H(tokens["productor"]), timeout=30)
