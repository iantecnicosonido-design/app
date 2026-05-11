"""Tests for Invoice price breakdown (rental + tech autonomo).

Covers _compute_invoice_amounts:
- Rental invoices: amount_excl_iva + iva_pct -> total_incl_iva, total_to_pay = total_incl_iva, irpf_pct=None.
- Tech invoices: amount_excl_iva + iva_pct + irpf_pct -> total_incl_iva = base+IVA,
  total_to_pay = total_incl_iva - base*IRPF/100.
- Legacy compat: only `amount` provided -> base reverse-computed assuming 21% IVA.
- RBAC: tech-invoices 403 for productor/almacen/taller and non-autonomo techs;
  rental-invoices 403 for almacen/taller/tecnico.
- DELETE permissions: productor anywhere, tech_id owner on their own tech invoice.
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://material-calendar.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EVENT_RENTAL = "c90536c0-2a70-4a1e-ab54-513a63fb477f"   # La Grand Band (productor tests)
EVENT_TECH = "83ee8bf6-359e-4d1a-a9b8-330a0c202147"     # La Gran Band (Ian assigned)

CREDS = {
    "productor": {"email": "Admin", "password": "Admin"},
    "almacen":   {"email": "Almacen", "password": "Almacen"},
    "taller":    {"email": "Taller", "password": "Taller"},
    "tecnico":   {"email": "ianedisonrent@gmail.com", "password": "TempPass2026!"},
}


def _login(role):
    r = requests.post(f"{API}/auth/login", json=CREDS[role], timeout=30)
    assert r.status_code == 200, f"login {role}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {role: _login(role) for role in CREDS}


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def file_payload(tokens):
    """Upload a small file once and return ExpenseFile payload."""
    files = {"file": ("invoice.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")}
    r = requests.post(f"{API}/upload",
                      headers={"Authorization": f"Bearer {tokens['productor']}"},
                      files=files, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"file_id": d["id"], "name": d["name"], "content_type": d.get("content_type") or "application/pdf"}


# ---------------- RENTAL INVOICES ----------------
class TestRentalInvoices:
    def test_create_with_breakdown(self, tokens, file_payload):
        payload = {
            "file": file_payload,
            "amount_excl_iva": 500.0,
            "iva_pct": 21.0,
            "provider_name": "TEST_Provider",
            "notes": "TEST_pytest rental",
        }
        r = requests.post(f"{API}/events/{EVENT_RENTAL}/rental-invoices",
                          headers=H(tokens["productor"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["amount_excl_iva"] == 500.0
        assert inv["iva_pct"] == 21.0
        assert inv["total_incl_iva"] == 605.0     # 500 * 1.21
        assert inv["total_to_pay"] == 605.0       # rentals: no IRPF
        assert inv["amount"] == 605.0             # legacy mirror
        assert inv.get("irpf_pct") in (None,)     # not stored
        assert inv["provider_name"] == "TEST_Provider"
        # cleanup
        requests.delete(f"{API}/events/{EVENT_RENTAL}/rental-invoices/{inv['id']}",
                        headers=H(tokens["productor"]), timeout=30)

    def test_create_legacy_amount_only(self, tokens, file_payload):
        payload = {
            "file": file_payload,
            "amount": 121.0,  # legacy: total con IVA
            "provider_name": "TEST_Legacy",
        }
        r = requests.post(f"{API}/events/{EVENT_RENTAL}/rental-invoices",
                          headers=H(tokens["productor"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        # 121 / 1.21 = 100.0
        assert inv["amount_excl_iva"] == 100.0
        assert inv["iva_pct"] == 21.0
        assert inv["total_incl_iva"] == 121.0
        assert inv["amount"] == 121.0
        requests.delete(f"{API}/events/{EVENT_RENTAL}/rental-invoices/{inv['id']}",
                        headers=H(tokens["productor"]), timeout=30)

    @pytest.mark.parametrize("role", ["almacen", "taller", "tecnico"])
    def test_rbac_post_rental_403(self, tokens, role, file_payload):
        payload = {"file": file_payload, "amount_excl_iva": 10, "iva_pct": 21, "provider_name": "x"}
        r = requests.post(f"{API}/events/{EVENT_RENTAL}/rental-invoices",
                          headers=H(tokens[role]), json=payload, timeout=30)
        assert r.status_code == 403, f"{role}: {r.status_code} {r.text}"

    @pytest.mark.parametrize("role", ["almacen", "taller", "tecnico"])
    def test_rbac_delete_rental_403(self, tokens, role):
        r = requests.delete(f"{API}/events/{EVENT_RENTAL}/rental-invoices/00000000-0000-0000-0000-000000000000",
                            headers=H(tokens[role]), timeout=30)
        assert r.status_code == 403

    def test_productor_delete_rental(self, tokens, file_payload):
        # create then delete
        r = requests.post(f"{API}/events/{EVENT_RENTAL}/rental-invoices",
                          headers=H(tokens["productor"]),
                          json={"file": file_payload, "amount_excl_iva": 50, "iva_pct": 21, "provider_name": "TEST_del"},
                          timeout=30)
        assert r.status_code == 200
        iid = r.json()["id"]
        rd = requests.delete(f"{API}/events/{EVENT_RENTAL}/rental-invoices/{iid}",
                             headers=H(tokens["productor"]), timeout=30)
        assert rd.status_code == 200
        ev = requests.get(f"{API}/events/{EVENT_RENTAL}", headers=H(tokens["productor"]), timeout=30).json()
        assert iid not in [i["id"] for i in (ev.get("rental_invoices") or [])]


# ---------------- TECH INVOICES (autonomo) ----------------
class TestTechInvoices:
    def test_create_with_breakdown_and_irpf(self, tokens, file_payload):
        """base=1000, IVA=21, IRPF=15 -> total_incl_iva=1210, total_to_pay=1060."""
        payload = {
            "file": file_payload,
            "amount_excl_iva": 1000.0,
            "iva_pct": 21.0,
            "irpf_pct": 15.0,
            "notes": "TEST_pytest tech",
        }
        r = requests.post(f"{API}/events/{EVENT_TECH}/tech-invoices",
                          headers=H(tokens["tecnico"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["amount_excl_iva"] == 1000.0
        assert inv["iva_pct"] == 21.0
        assert inv["irpf_pct"] == 15.0
        assert inv["total_incl_iva"] == 1210.0
        assert inv["total_to_pay"] == 1060.0
        assert inv["amount"] == 1210.0  # legacy mirror = total_incl_iva
        assert inv["tech_id"]
        # cleanup
        requests.delete(f"{API}/events/{EVENT_TECH}/tech-invoices/{inv['id']}",
                        headers=H(tokens["tecnico"]), timeout=30)

    def test_create_legacy_amount(self, tokens, file_payload):
        """If only legacy `amount` sent, base reverse-computed at 21% IVA."""
        payload = {"file": file_payload, "amount": 1210.0, "notes": "TEST_legacy"}
        r = requests.post(f"{API}/events/{EVENT_TECH}/tech-invoices",
                          headers=H(tokens["tecnico"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["amount_excl_iva"] == 1000.0
        assert inv["iva_pct"] == 21.0
        assert inv["irpf_pct"] == 0.0
        assert inv["total_incl_iva"] == 1210.0
        assert inv["total_to_pay"] == 1210.0  # no IRPF given -> equal to total_incl_iva
        requests.delete(f"{API}/events/{EVENT_TECH}/tech-invoices/{inv['id']}",
                        headers=H(tokens["tecnico"]), timeout=30)

    def test_tech_owner_can_delete_own(self, tokens, file_payload):
        r = requests.post(f"{API}/events/{EVENT_TECH}/tech-invoices",
                          headers=H(tokens["tecnico"]),
                          json={"file": file_payload, "amount_excl_iva": 100, "iva_pct": 21, "irpf_pct": 0},
                          timeout=30)
        assert r.status_code == 200
        iid = r.json()["id"]
        rd = requests.delete(f"{API}/events/{EVENT_TECH}/tech-invoices/{iid}",
                             headers=H(tokens["tecnico"]), timeout=30)
        assert rd.status_code == 200

    def test_productor_can_delete_tech_invoice(self, tokens, file_payload):
        r = requests.post(f"{API}/events/{EVENT_TECH}/tech-invoices",
                          headers=H(tokens["tecnico"]),
                          json={"file": file_payload, "amount_excl_iva": 200, "iva_pct": 21, "irpf_pct": 15},
                          timeout=30)
        assert r.status_code == 200
        iid = r.json()["id"]
        rd = requests.delete(f"{API}/events/{EVENT_TECH}/tech-invoices/{iid}",
                             headers=H(tokens["productor"]), timeout=30)
        assert rd.status_code == 200

    def test_listing_includes_breakdown_fields(self, tokens, file_payload):
        # create, GET event, verify fields exposed
        r = requests.post(f"{API}/events/{EVENT_TECH}/tech-invoices",
                          headers=H(tokens["tecnico"]),
                          json={"file": file_payload, "amount_excl_iva": 1000, "iva_pct": 21, "irpf_pct": 15},
                          timeout=30)
        iid = r.json()["id"]
        ev = requests.get(f"{API}/events/{EVENT_TECH}", headers=H(tokens["productor"]), timeout=30).json()
        inv = next(i for i in ev["tech_invoices"] if i["id"] == iid)
        for k in ("amount_excl_iva", "iva_pct", "irpf_pct", "total_incl_iva", "total_to_pay"):
            assert k in inv, f"missing field {k} in tech_invoice listing"
        assert inv["total_incl_iva"] == 1210.0
        assert inv["total_to_pay"] == 1060.0
        # cleanup
        requests.delete(f"{API}/events/{EVENT_TECH}/tech-invoices/{iid}",
                        headers=H(tokens["productor"]), timeout=30)

    @pytest.mark.parametrize("role", ["productor", "almacen", "taller"])
    def test_rbac_non_tecnico_403(self, tokens, role, file_payload):
        payload = {"file": file_payload, "amount_excl_iva": 100, "iva_pct": 21, "irpf_pct": 15}
        r = requests.post(f"{API}/events/{EVENT_TECH}/tech-invoices",
                          headers=H(tokens[role]), json=payload, timeout=30)
        assert r.status_code == 403, f"{role}: {r.status_code} {r.text}"


# ---------------- ZZ cleanup ----------------
def test_zz_cleanup(tokens):
    # Remove any TEST_-tagged invoices left over
    for eid in (EVENT_RENTAL, EVENT_TECH):
        ev = requests.get(f"{API}/events/{eid}", headers=H(tokens["productor"]), timeout=30).json()
        for inv in (ev.get("rental_invoices") or []):
            if (inv.get("provider_name") or "").startswith("TEST_") or (inv.get("notes") or "").startswith("TEST_"):
                requests.delete(f"{API}/events/{eid}/rental-invoices/{inv['id']}",
                                headers=H(tokens["productor"]), timeout=30)
        for inv in (ev.get("tech_invoices") or []):
            if (inv.get("notes") or "").startswith("TEST_"):
                requests.delete(f"{API}/events/{eid}/tech-invoices/{inv['id']}",
                                headers=H(tokens["productor"]), timeout=30)
