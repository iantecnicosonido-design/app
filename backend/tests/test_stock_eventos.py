import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://material-calendar.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
S = requests.Session()
S.headers.update({"Content-Type": "application/json"})


# --- Stats / seed ---
def test_stats_seeded():
    r = S.get(f"{API}/stats", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["total_materials"] >= 262, d
    assert "by_category" in d


# --- Materials ---
def test_materials_list_filter_search():
    r = S.get(f"{API}/materials", timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    r = S.get(f"{API}/materials?category=audio", timeout=30)
    assert r.status_code == 200
    assert all(m["category"] == "audio" for m in r.json())
    r = S.get(f"{API}/materials?q=cable", timeout=30)
    assert r.status_code == 200


@pytest.fixture
def temp_material():
    r = S.post(f"{API}/materials", json={"category": "audio", "name": "TEST_Mat", "quantity": 10})
    assert r.status_code == 200, r.text
    m = r.json()
    yield m
    S.delete(f"{API}/materials/{m['id']}")


def test_material_crud(temp_material):
    mid = temp_material["id"]
    # GET via list to verify persistence
    r = S.get(f"{API}/materials?q=TEST_Mat")
    assert any(x["id"] == mid for x in r.json())
    # update
    r = S.put(f"{API}/materials/{mid}", json={"quantity": 25})
    assert r.status_code == 200 and r.json()["quantity"] == 25
    # 404
    r = S.put(f"{API}/materials/nonexistent", json={"quantity": 5})
    assert r.status_code == 404
    r = S.delete(f"{API}/materials/nonexistent")
    assert r.status_code == 404


# --- Providers ---
def test_provider_crud():
    r = S.post(f"{API}/providers", json={"name": "TEST_Prov", "phone": "123"})
    assert r.status_code == 200
    pid = r.json()["id"]
    r = S.get(f"{API}/providers")
    assert any(p["id"] == pid for p in r.json())
    r = S.put(f"{API}/providers/{pid}", json={"name": "TEST_Prov2", "phone": "456"})
    assert r.status_code == 200 and r.json()["name"] == "TEST_Prov2"
    r = S.delete(f"{API}/providers/{pid}")
    assert r.status_code == 200


# --- Events full flow ---
def test_event_full_flow(temp_material):
    mid = temp_material["id"]
    # create event
    r = S.post(f"{API}/events", json={
        "name": "TEST_Event", "type": "alquiler", "client_name": "C1",
        "reference": "R1", "location": "L1",
        "setup_date": "2026-02-01", "event_date": "2026-02-02",
        "schedule": "10:00-22:00"
    })
    assert r.status_code == 200, r.text
    eid = r.json()["id"]

    # list & get
    assert S.get(f"{API}/events").status_code == 200
    r = S.get(f"{API}/events/{eid}")
    assert r.status_code == 200 and r.json()["name"] == "TEST_Event"

    # update
    r = S.put(f"{API}/events/{eid}", json={"location": "L2"})
    assert r.json()["location"] == "L2"

    # block material
    r = S.post(f"{API}/events/{eid}/materials", json={"material_id": mid, "quantity": 4})
    assert r.status_code == 200
    assert any(m["material_id"] == mid and m["quantity"] == 4 for m in r.json()["materials"])
    r = S.get(f"{API}/materials?q=TEST_Mat").json()
    assert next(x for x in r if x["id"] == mid)["blocked"] == 4

    # delta update (modify same material)
    r = S.post(f"{API}/events/{eid}/materials", json={"material_id": mid, "quantity": 6})
    assert next(m for m in r.json()["materials"] if m["material_id"] == mid)["quantity"] == 6
    assert next(x for x in S.get(f"{API}/materials?q=TEST_Mat").json() if x["id"] == mid)["blocked"] == 6

    # exceed available
    r = S.post(f"{API}/events/{eid}/materials", json={"material_id": mid, "quantity": 999})
    assert r.status_code == 400

    # quantity 0 removes
    r = S.post(f"{API}/events/{eid}/materials", json={"material_id": mid, "quantity": 0})
    assert all(m["material_id"] != mid for m in r.json()["materials"])
    assert next(x for x in S.get(f"{API}/materials?q=TEST_Mat").json() if x["id"] == mid)["blocked"] == 0

    # re-block then unblock via DELETE
    S.post(f"{API}/events/{eid}/materials", json={"material_id": mid, "quantity": 3})
    r = S.delete(f"{API}/events/{eid}/materials/{mid}")
    assert r.status_code == 200
    assert next(x for x in S.get(f"{API}/materials?q=TEST_Mat").json() if x["id"] == mid)["blocked"] == 0

    # rentals
    rp = S.post(f"{API}/providers", json={"name": "TEST_RentProv"}).json()
    r = S.post(f"{API}/events/{eid}/rentals", json={
        "name": "Foco extra", "quantity": 2, "provider_id": rp["id"]
    })
    assert r.status_code == 200
    rentals = r.json()["rentals"]
    assert len(rentals) == 1 and rentals[0]["provider_name"] == "TEST_RentProv"
    rid = rentals[0]["id"]
    r = S.delete(f"{API}/events/{eid}/rentals/{rid}")
    assert r.status_code == 200 and r.json()["rentals"] == []

    # close event blocks modifications
    r = S.post(f"{API}/events/{eid}/close")
    assert r.status_code == 200 and r.json()["status"] == "cerrado"
    r = S.post(f"{API}/events/{eid}/materials", json={"material_id": mid, "quantity": 1})
    assert r.status_code == 400
    r = S.post(f"{API}/events/{eid}/rentals", json={"name": "x", "quantity": 1})
    assert r.status_code == 400

    # PDF export
    r = S.get(f"{API}/events/{eid}/export")
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"

    # reopen
    r = S.post(f"{API}/events/{eid}/reopen")
    assert r.json()["status"] == "abierto"

    # block again, delete event restores stock
    S.post(f"{API}/events/{eid}/materials", json={"material_id": mid, "quantity": 2})
    assert next(x for x in S.get(f"{API}/materials?q=TEST_Mat").json() if x["id"] == mid)["blocked"] == 2
    r = S.delete(f"{API}/events/{eid}")
    assert r.status_code == 200
    assert next(x for x in S.get(f"{API}/materials?q=TEST_Mat").json() if x["id"] == mid)["blocked"] == 0

    S.delete(f"{API}/providers/{rp['id']}")


def test_material_blocked_cannot_delete(temp_material):
    mid = temp_material["id"]
    ev = S.post(f"{API}/events", json={"name": "TEST_BlockDel"}).json()
    S.post(f"{API}/events/{ev['id']}/materials", json={"material_id": mid, "quantity": 1})
    r = S.delete(f"{API}/materials/{mid}")
    assert r.status_code == 400
    S.delete(f"{API}/events/{ev['id']}")
