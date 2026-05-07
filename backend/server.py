from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import io
import logging
import requests as http_requests
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
import uuid
from datetime import datetime, timezone

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.utils import ImageReader


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
LOGO_PATH = ROOT_DIR / "assets" / "logo.png"

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Storage ----------
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
APP_NAME = os.environ.get("APP_NAME", "stock-eventos")
_storage_key = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        return None
    try:
        r = http_requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=20)
        r.raise_for_status()
        _storage_key = r.json()["storage_key"]
        return _storage_key
    except Exception as e:
        logging.warning(f"Storage init failed: {e}")
        return None


def put_object(path: str, data: bytes, content_type: str):
    key = init_storage()
    if not key:
        raise HTTPException(503, "Storage not available")
    r = http_requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=60,
    )
    r.raise_for_status()
    return r.json()


def get_object(path: str):
    key = init_storage()
    if not key:
        raise HTTPException(503, "Storage not available")
    r = http_requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=30)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


# ---------- Constants ----------
Category = str
EventType = Literal["alquiler", "bolo"]
EventStatus = Literal["abierto", "cerrado"]
UnitStatus = Literal["available", "broken", "repair"]

DEFAULT_CATEGORIES = [
    {"key": "audio", "label": "Audio", "prefix": "AUD", "has_subitems": True, "has_unit_refs": True, "order": 1},
    {"key": "video", "label": "Video", "prefix": "VID", "has_subitems": True, "has_unit_refs": True, "order": 2},
    {"key": "luces", "label": "Luces", "prefix": "LUC", "has_subitems": True, "has_unit_refs": True, "order": 3},
    {"key": "estructuras", "label": "Estructuras", "prefix": "EST", "has_subitems": True, "has_unit_refs": True, "order": 4},
    {"key": "cables", "label": "Cables", "prefix": "CAB", "has_subitems": False, "has_unit_refs": False, "order": 5},
]
PROJ = {"_id": 0}


class CategoryModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    key: str
    label: str
    prefix: str
    has_subitems: bool = True
    has_unit_refs: bool = True
    order: int = 100


class CategoryCreate(BaseModel):
    key: str
    label: str
    prefix: str
    has_subitems: bool = True
    has_unit_refs: bool = True


class CategoryUpdate(BaseModel):
    label: Optional[str] = None
    prefix: Optional[str] = None
    has_subitems: Optional[bool] = None
    has_unit_refs: Optional[bool] = None
    order: Optional[int] = None


# ---------- Models ----------
class Subitem(BaseModel):
    type: Literal["unit", "free"] = "free"
    unit_id: Optional[str] = None
    name: str
    qty: int = 1
    unit_reference: Optional[str] = None


class Material(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: Category
    name: str
    reference: str = ""  # base reference, e.g. AUD-0001
    quantity: int = 0    # = number of units
    blocked: int = 0     # informational, computed from units in events


class MaterialUnit(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    material_id: str
    reference: str = ""  # AUD-0001-01
    seq: int = 1
    status: UnitStatus = "available"
    subitems: List[Subitem] = []
    notes: str = ""


class MaterialCreate(BaseModel):
    category: Category
    name: str
    reference: Optional[str] = None
    quantity: int = 0


class MaterialUpdate(BaseModel):
    category: Optional[Category] = None
    name: Optional[str] = None
    reference: Optional[str] = None


class UnitUpdate(BaseModel):
    reference: Optional[str] = None
    status: Optional[UnitStatus] = None
    subitems: Optional[List[Subitem]] = None
    notes: Optional[str] = None


class EventUnitSnapshot(BaseModel):
    unit_id: str
    reference: str
    subitems: List[Subitem] = []
    flightcase: str = ""


class EventMaterial(BaseModel):
    material_id: str
    name: str
    category: str
    reference: str = ""
    units: List[EventUnitSnapshot] = []


class RentalItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    quantity: int
    provider_id: Optional[str] = None
    provider_name: str = ""
    notes: str = ""


class Event(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: EventType = "alquiler"
    client_name: str = ""
    client_contact: str = ""
    reference: str = ""
    location: str = ""
    setup_date: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None
    schedule: str = ""
    notes: str = ""
    warehouse_out_dt: Optional[str] = None
    return_dt: Optional[str] = None
    setup_start_dt: Optional[str] = None
    setup_end_dt: Optional[str] = None
    act_start_dt: Optional[str] = None
    act_end_dt: Optional[str] = None
    dismount_start_dt: Optional[str] = None
    dismount_end_dt: Optional[str] = None
    status: EventStatus = "abierto"
    materials: List[EventMaterial] = []
    rentals: List[RentalItem] = []
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EventCreate(BaseModel):
    name: str
    type: EventType = "alquiler"
    client_name: str = ""
    client_contact: str = ""
    reference: str = ""
    location: str = ""
    setup_date: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None
    schedule: str = ""
    notes: str = ""
    warehouse_out_dt: Optional[str] = None
    return_dt: Optional[str] = None
    setup_start_dt: Optional[str] = None
    setup_end_dt: Optional[str] = None
    act_start_dt: Optional[str] = None
    act_end_dt: Optional[str] = None
    dismount_start_dt: Optional[str] = None
    dismount_end_dt: Optional[str] = None


class EventUpdate(EventCreate):
    name: Optional[str] = None
    type: Optional[EventType] = None
    status: Optional[EventStatus] = None


class BlockMaterialRequest(BaseModel):
    material_id: str
    quantity: Optional[int] = None
    unit_ids: Optional[List[str]] = None


class RentalCreate(BaseModel):
    name: str
    quantity: int
    provider_id: Optional[str] = None
    provider_name: str = ""
    notes: str = ""


class Provider(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    contact: str = ""
    phone: str = ""
    email: str = ""
    notes: str = ""


class ProviderCreate(BaseModel):
    name: str
    contact: str = ""
    phone: str = ""
    email: str = ""
    notes: str = ""


class BulkEventsRequest(BaseModel):
    events: List[EventCreate]


class Flightcase(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    notes: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class FlightcaseCreate(BaseModel):
    name: str
    description: str = ""
    notes: str = ""


class FlightcaseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class CableDistributionRequest(BaseModel):
    material_id: str
    distribution: Dict[str, int]  # {flightcase_name: qty}, "" key for unassigned


class IncidentCreate(BaseModel):
    unit_id: str
    status: Literal["broken", "repair"] = "broken"
    description: str
    files: List[Dict[str, Any]] = []  # [{path, name, content_type}]


class IncidentLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    unit_id: str
    type: Literal["report", "update", "resolve"]
    status: str = ""
    description: str = ""
    files: List[Dict[str, Any]] = []
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class IncidentResolve(BaseModel):
    description: str = ""
    files: List[Dict[str, Any]] = []


class PackItem(BaseModel):
    material_id: str
    name: str = ""
    quantity: int


class Pack(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    items: List[PackItem] = []


class PackCreate(BaseModel):
    name: str
    description: str = ""
    items: List[PackItem] = []


# ---------- Helpers ----------
async def get_category(key: str) -> dict:
    cat = await db.categories.find_one({"key": key}, PROJ)
    return cat or {"key": key, "prefix": "REF", "has_subitems": True, "has_unit_refs": True, "label": key}


async def next_base_reference(category: str) -> str:
    cat = await get_category(category)
    prefix = cat.get("prefix", "REF")
    cursor = db.materials.find({"category": category, "reference": {"$regex": f"^{prefix}-"}}, {"reference": 1, "_id": 0})
    max_n = 0
    async for d in cursor:
        try:
            n = int(d["reference"].split("-", 1)[1].split("-")[0])
            if n > max_n:
                max_n = n
        except Exception:
            pass
    return f"{prefix}-{max_n + 1:04d}"


async def create_units_for_material(material: dict, count: int, start_seq: int = 1):
    cat = await get_category(material["category"])
    has_unit_refs = cat.get("has_unit_refs", True)
    docs = []
    for i in range(start_seq, start_seq + count):
        ref = f"{material['reference']}-{i:02d}" if has_unit_refs else material["reference"]
        u = MaterialUnit(material_id=material["id"], reference=ref, seq=i, status="available")
        docs.append(u.model_dump())
    if docs:
        await db.units.insert_many(docs)


def parse_dt(s: Optional[str]):
    if not s:
        return None
    try:
        s2 = s.replace("Z", "")
        if "T" not in s2 and len(s2) == 10:
            s2 = s2 + "T00:00:00"
        if s2.count(":") == 1:
            s2 = s2 + ":00"
        return datetime.fromisoformat(s2)
    except Exception:
        return None


def event_window(ev: dict):
    typ = ev.get("type", "alquiler")
    if typ == "bolo":
        s = parse_dt(ev.get("warehouse_out_dt")) or parse_dt(ev.get("setup_date"))
        e = parse_dt(ev.get("dismount_end_dt")) or parse_dt(ev.get("end_date")) or parse_dt(ev.get("event_date"))
    else:
        s = parse_dt(ev.get("warehouse_out_dt")) or parse_dt(ev.get("setup_date")) or parse_dt(ev.get("event_date"))
        e = parse_dt(ev.get("return_dt")) or parse_dt(ev.get("end_date")) or parse_dt(ev.get("event_date"))
    if e and e.hour == 0 and e.minute == 0 and e.second == 0:
        e = e.replace(hour=23, minute=59, second=59)
    return s, e


def overlaps(a, b) -> bool:
    if not a[0] or not a[1] or not b[0] or not b[1]:
        return True
    return a[0] < b[1] and b[0] < a[1]


def event_unit_ids(ev: dict) -> set:
    ids = set()
    for em in ev.get("materials", []):
        for u in em.get("units", []):
            ids.add(u["unit_id"])
            for s in u.get("subitems", []):
                if s.get("type") == "unit" and s.get("unit_id"):
                    ids.add(s["unit_id"])
    return ids


async def material_blocked_count(material_id: str) -> int:
    """Count units of this material currently in any event."""
    n = 0
    async for ev in db.events.find({}, PROJ):
        for em in ev.get("materials", []):
            if em.get("material_id") == material_id:
                n += len(em.get("units", []))
    # plus units in incidents (broken/repair)
    n += await db.units.count_documents({"material_id": material_id, "status": {"$in": ["broken", "repair"]}})
    return n


# ---------- Migration / Seed ----------
async def seed_and_migrate():
    # 0. seed categories if empty
    if await db.categories.count_documents({}) == 0:
        await db.categories.insert_many([CategoryModel(**c).model_dump() for c in DEFAULT_CATEGORIES])
    # ensure cables category exists
    if not await db.categories.find_one({"key": "cables"}):
        await db.categories.insert_one(CategoryModel(**{"key": "cables", "label": "Cables", "prefix": "CAB", "has_subitems": False, "has_unit_refs": False, "order": 5}).model_dump())

    # 1. seed materials if empty
    if await db.materials.count_documents({}) == 0:
        seed_path = ROOT_DIR / "seed_inventory.json"
        if seed_path.exists():
            with open(seed_path, "r", encoding="utf-8") as f:
                items = json.load(f)
            counters: Dict[str, int] = {}
            for it in items:
                cat = it["category"]
                counters[cat] = counters.get(cat, 0) + 1
                cat_doc = await get_category(cat)
                ref = f"{cat_doc.get('prefix','REF')}-{counters[cat]:04d}"
                m = Material(category=cat, name=it["name"], quantity=int(it["quantity"]), reference=ref)
                await db.materials.insert_one(m.model_dump())

    # 2. ensure each material has a base reference
    cursor = db.materials.find({"$or": [{"reference": {"$exists": False}}, {"reference": ""}]})
    async for d in cursor:
        ref = await next_base_reference(d["category"])
        await db.materials.update_one({"id": d["id"]}, {"$set": {"reference": ref}})

    # 3. migrate "cable" materials → cables category (one-time)
    import re
    cab_re = re.compile(r"\bcable\b", re.IGNORECASE)
    async for m in db.materials.find({"category": {"$ne": "cables"}}, PROJ):
        if cab_re.search(m["name"]):
            new_ref = await next_base_reference("cables")
            await db.materials.update_one({"id": m["id"]}, {"$set": {"category": "cables", "reference": new_ref}})
            # update unit refs (for cables, single ref no -NN)
            await db.units.update_many({"material_id": m["id"]}, {"$set": {"reference": new_ref}})

    # 4. create unit docs for each material if missing
    async for m in db.materials.find({}, PROJ):
        existing = await db.units.count_documents({"material_id": m["id"]})
        target = m.get("quantity", 0)
        if existing < target:
            await create_units_for_material(m, target - existing, start_seq=existing + 1)

    # 5. clear deprecated 'subitems' on materials
    await db.materials.update_many({"subitems": {"$exists": True}}, {"$unset": {"subitems": ""}})


# ---------- Categories ----------
@api_router.get("/categories")
async def list_categories():
    return await db.categories.find({}, PROJ).sort("order", 1).to_list(200)


@api_router.post("/categories", response_model=CategoryModel)
async def create_category(payload: CategoryCreate):
    if await db.categories.find_one({"key": payload.key}):
        raise HTTPException(400, "Esta clave ya existe")
    last = await db.categories.find({}, PROJ).sort("order", -1).limit(1).to_list(1)
    order = (last[0]["order"] if last else 0) + 1
    c = CategoryModel(**payload.model_dump(), order=order)
    await db.categories.insert_one(c.model_dump())
    return c


@api_router.put("/categories/{key}")
async def update_category(key: str, payload: CategoryUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "Sin cambios")
    res = await db.categories.find_one_and_update({"key": key}, {"$set": update}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Categoría no encontrada")
    return res


@api_router.delete("/categories/{key}")
async def delete_category(key: str):
    if await db.materials.count_documents({"category": key}) > 0:
        raise HTTPException(400, "Hay materiales en esta categoría. Muévelos primero.")
    await db.categories.delete_one({"key": key})
    return {"ok": True}


# ---------- Materials & Units ----------
@api_router.get("/materials")
async def list_materials(category: Optional[str] = None, q: Optional[str] = None):
    query = {}
    if category:
        query["category"] = category
    if q:
        # search by material name OR reference OR unit reference
        unit_match = await db.units.find({"reference": {"$regex": q, "$options": "i"}}, {"material_id": 1, "_id": 0}).to_list(500)
        unit_mat_ids = list({u["material_id"] for u in unit_match})
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"reference": {"$regex": q, "$options": "i"}},
            {"id": {"$in": unit_mat_ids}},
        ]
    items = await db.materials.find(query, PROJ).sort("reference", 1).to_list(5000)
    # enrich with blocked + units count
    for it in items:
        it["blocked"] = await material_blocked_count(it["id"])
        it["unit_count"] = await db.units.count_documents({"material_id": it["id"]})
    return items


@api_router.post("/materials", response_model=Material)
async def create_material(payload: MaterialCreate):
    data = payload.model_dump()
    if not data.get("reference"):
        data["reference"] = await next_base_reference(data["category"])
    m = Material(**data)
    await db.materials.insert_one(m.model_dump())
    if data.get("quantity", 0) > 0:
        await create_units_for_material(m.model_dump(), data["quantity"])
    return m


@api_router.put("/materials/{material_id}", response_model=Material)
async def update_material(material_id: str, payload: MaterialUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    res = await db.materials.find_one_and_update(
        {"id": material_id}, {"$set": update}, return_document=True, projection=PROJ
    )
    if not res:
        raise HTTPException(404, "Material not found")
    return res


@api_router.delete("/materials/{material_id}")
async def delete_material(material_id: str):
    m = await db.materials.find_one({"id": material_id}, PROJ)
    if not m:
        raise HTTPException(404, "Material not found")
    if await material_blocked_count(material_id) > 0:
        raise HTTPException(400, "Material con unidades bloqueadas o en avería. Libera primero.")
    await db.units.delete_many({"material_id": material_id})
    await db.materials.delete_one({"id": material_id})
    return {"ok": True}


@api_router.get("/units")
async def list_units(material_id: Optional[str] = None, status: Optional[str] = None):
    q = {}
    if material_id:
        q["material_id"] = material_id
    if status:
        q["status"] = status
    units = await db.units.find(q, PROJ).sort("seq", 1).to_list(10000)
    return units


@api_router.post("/materials/{material_id}/units", response_model=MaterialUnit)
async def add_unit(material_id: str):
    m = await db.materials.find_one({"id": material_id}, PROJ)
    if not m:
        raise HTTPException(404, "Material not found")
    existing = await db.units.count_documents({"material_id": material_id})
    next_seq = existing + 1
    u = MaterialUnit(material_id=material_id, reference=f"{m['reference']}-{next_seq:02d}", seq=next_seq)
    await db.units.insert_one(u.model_dump())
    await db.materials.update_one({"id": material_id}, {"$inc": {"quantity": 1}})
    return u


@api_router.put("/units/{unit_id}")
async def update_unit(unit_id: str, payload: UnitUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    # enrich subitems with unit reference if linking
    if "subitems" in update:
        enriched = []
        for s in update["subitems"]:
            if s.get("type") == "unit" and s.get("unit_id"):
                u = await db.units.find_one({"id": s["unit_id"]}, PROJ)
                if u:
                    s["unit_reference"] = u["reference"]
                    if not s.get("name"):
                        m = await db.materials.find_one({"id": u["material_id"]}, PROJ)
                        s["name"] = m["name"] if m else ""
            enriched.append(s)
        update["subitems"] = enriched
    res = await db.units.find_one_and_update({"id": unit_id}, {"$set": update}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Unit not found")
    return res


@api_router.delete("/units/{unit_id}")
async def delete_unit(unit_id: str):
    u = await db.units.find_one({"id": unit_id}, PROJ)
    if not u:
        raise HTTPException(404, "Unit not found")
    # check not in any open event
    async for ev in db.events.find({}, PROJ):
        for em in ev.get("materials", []):
            for unit in em.get("units", []):
                if unit["unit_id"] == unit_id:
                    raise HTTPException(400, "Unidad bloqueada en evento. Libera primero.")
    await db.units.delete_one({"id": unit_id})
    await db.materials.update_one({"id": u["material_id"]}, {"$inc": {"quantity": -1}})
    return {"ok": True}


# ---------- Providers ----------
@api_router.get("/providers", response_model=List[Provider])
async def list_providers():
    return await db.providers.find({}, PROJ).sort("name", 1).to_list(1000)


@api_router.post("/providers", response_model=Provider)
async def create_provider(payload: ProviderCreate):
    p = Provider(**payload.model_dump())
    await db.providers.insert_one(p.model_dump())
    return p


@api_router.put("/providers/{pid}", response_model=Provider)
async def update_provider(pid: str, payload: ProviderCreate):
    res = await db.providers.find_one_and_update({"id": pid}, {"$set": payload.model_dump()}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Provider not found")
    return res


@api_router.delete("/providers/{pid}")
async def delete_provider(pid: str):
    p = await db.providers.find_one({"id": pid}, PROJ)
    if not p:
        raise HTTPException(404, "Provider not found")
    await db.providers.delete_one({"id": pid})
    return {"ok": True}


# ---------- Events ----------
@api_router.get("/events", response_model=List[Event])
async def list_events():
    return await db.events.find({}, PROJ).sort("event_date", 1).to_list(5000)


@api_router.get("/events/{eid}", response_model=Event)
async def get_event(eid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    return ev


@api_router.post("/events", response_model=Event)
async def create_event(payload: EventCreate):
    e = Event(**payload.model_dump())
    await db.events.insert_one(e.model_dump())
    return e


@api_router.post("/events/bulk")
async def bulk_create_events(payload: BulkEventsRequest):
    docs = [Event(**ec.model_dump()).model_dump() for ec in payload.events]
    if docs:
        await db.events.insert_many(docs)
    return {"created": len(docs)}


@api_router.put("/events/{eid}", response_model=Event)
async def update_event(eid: str, payload: EventUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    res = await db.events.find_one_and_update({"id": eid}, {"$set": update}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Event not found")
    return res


@api_router.delete("/events/{eid}")
async def delete_event(eid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    await db.events.delete_one({"id": eid})
    return {"ok": True}


# ---------- Material availability for an event ----------
@api_router.get("/events/{eid}/availability")
async def event_availability(eid: str, material_id: str):
    """Return list of available units for given material in the event's time window."""
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    units = await db.units.find({"material_id": material_id}, PROJ).sort("seq", 1).to_list(5000)
    cw = event_window(ev)
    others = await db.events.find({"id": {"$ne": eid}}, PROJ).to_list(5000)
    busy_ids: set = set()
    for oev in others:
        if overlaps(cw, event_window(oev)):
            busy_ids |= event_unit_ids(oev)
    out = []
    for u in units:
        unavailable_reason = None
        if u["status"] == "broken":
            unavailable_reason = "averiado"
        elif u["status"] == "repair":
            unavailable_reason = "reparación"
        elif u["id"] in busy_ids:
            unavailable_reason = "solapamiento"
        out.append({
            "id": u["id"],
            "reference": u["reference"],
            "status": u["status"],
            "subitems": u.get("subitems", []),
            "available": unavailable_reason is None,
            "reason": unavailable_reason,
        })
    return {"units": out, "available_count": sum(1 for x in out if x["available"])}


# ---------- Block / unblock material ----------
async def _block_units(eid: str, material_id: str, unit_ids: List[str]):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    M = await db.materials.find_one({"id": material_id}, PROJ)
    if not M:
        raise HTTPException(404, "Material not found")
    cw = event_window(ev)
    others = await db.events.find({"id": {"$ne": eid}}, PROJ).to_list(5000)
    busy_ids: set = set()
    for oev in others:
        if overlaps(cw, event_window(oev)):
            busy_ids |= event_unit_ids(oev)
    self_ids = event_unit_ids(ev) - {uid for uid in event_unit_ids(ev)}  # we'll replace this material entry, recompute below

    # Build snapshots and validate
    snaps = []
    extra_unit_blocks: Dict[str, List[EventUnitSnapshot]] = {}  # other materials whose subitem-units are also locked
    for uid in unit_ids:
        u = await db.units.find_one({"id": uid}, PROJ)
        if not u:
            raise HTTPException(404, f"Unidad {uid} no encontrada")
        if u["material_id"] != material_id:
            raise HTTPException(400, "La unidad no pertenece al material indicado")
        if u["status"] != "available":
            raise HTTPException(400, f"Unidad {u['reference']} en estado {u['status']}")
        if u["id"] in busy_ids:
            raise HTTPException(400, f"Unidad {u['reference']} solapa con otro evento")
        # subitems: also block any 'unit' subitems
        for s in u.get("subitems", []):
            if s.get("type") == "unit" and s.get("unit_id"):
                sub_u = await db.units.find_one({"id": s["unit_id"]}, PROJ)
                if not sub_u:
                    continue
                if sub_u["status"] != "available":
                    raise HTTPException(400, f"Subítem {sub_u['reference']} en estado {sub_u['status']}")
                if sub_u["id"] in busy_ids:
                    raise HTTPException(400, f"Subítem {sub_u['reference']} solapa con otro evento")
                # group by material_id
                snap_sub = EventUnitSnapshot(unit_id=sub_u["id"], reference=sub_u["reference"], subitems=[])
                extra_unit_blocks.setdefault(sub_u["material_id"], []).append(snap_sub)
        snaps.append(EventUnitSnapshot(unit_id=u["id"], reference=u["reference"], subitems=[Subitem(**s) for s in u.get("subitems", [])]))

    # Remove existing entry for this material
    await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": material_id}}})
    # Insert new entry
    em = EventMaterial(
        material_id=material_id, name=M["name"], category=M["category"], reference=M.get("reference", ""),
        units=snaps,
    )
    await db.events.update_one({"id": eid}, {"$push": {"materials": em.model_dump()}})

    # For extra subitem-unit blocks: merge into respective material entries
    for sub_mid, sub_snaps in extra_unit_blocks.items():
        SubM = await db.materials.find_one({"id": sub_mid}, PROJ)
        if not SubM:
            continue
        ev2 = await db.events.find_one({"id": eid}, PROJ)
        existing = next((em for em in ev2.get("materials", []) if em["material_id"] == sub_mid), None)
        existing_uids = set()
        if existing:
            existing_uids = {u["unit_id"] for u in existing["units"]}
            new_units = [s for s in sub_snaps if s.unit_id not in existing_uids]
            if new_units:
                await db.events.update_one(
                    {"id": eid, "materials.material_id": sub_mid},
                    {"$push": {"materials.$.units": {"$each": [u.model_dump() for u in new_units]}}}
                )
        else:
            sub_em = EventMaterial(
                material_id=sub_mid, name=SubM["name"], category=SubM["category"],
                reference=SubM.get("reference", ""), units=sub_snaps,
            )
            await db.events.update_one({"id": eid}, {"$push": {"materials": sub_em.model_dump()}})

    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/materials")
async def block_material(eid: str, payload: BlockMaterialRequest):
    if payload.unit_ids:
        return await _block_units(eid, payload.material_id, payload.unit_ids)
    if payload.quantity is None or payload.quantity < 0:
        raise HTTPException(400, "quantity o unit_ids requerido")
    if payload.quantity == 0:
        # treat as unblock
        await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": payload.material_id}}})
        return await db.events.find_one({"id": eid}, PROJ)
    # auto-pick available units
    avail = await event_availability(eid, payload.material_id)
    avail_units = [u for u in avail["units"] if u["available"]]
    if len(avail_units) < payload.quantity:
        raise HTTPException(400, f"Solo {len(avail_units)} unidades disponibles, pides {payload.quantity}")
    chosen = [u["id"] for u in avail_units[: payload.quantity]]
    return await _block_units(eid, payload.material_id, chosen)


@api_router.delete("/events/{eid}/materials/{material_id}")
async def unblock_material(eid: str, material_id: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": material_id}}})
    return await db.events.find_one({"id": eid}, PROJ)


# ---------- Flightcases (library) ----------
@api_router.get("/flightcases", response_model=List[Flightcase])
async def list_flightcases():
    items = await db.flightcases.find({}, PROJ).sort("name", 1).to_list(1000)
    return items


@api_router.post("/flightcases", response_model=Flightcase)
async def create_flightcase(payload: FlightcaseCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Nombre obligatorio")
    existing = await db.flightcases.find_one({"name": name}, PROJ)
    if existing:
        raise HTTPException(400, "Ya existe un flightcase con ese nombre")
    fc = Flightcase(name=name, description=payload.description, notes=payload.notes)
    await db.flightcases.insert_one(fc.model_dump())
    return fc


@api_router.put("/flightcases/{fid}", response_model=Flightcase)
async def update_flightcase(fid: str, payload: FlightcaseUpdate):
    fc = await db.flightcases.find_one({"id": fid}, PROJ)
    if not fc:
        raise HTTPException(404, "Flightcase no encontrado")
    upd = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    old_name = fc["name"]
    new_name = upd.get("name", old_name).strip() if "name" in upd else old_name
    if "name" in upd:
        if not new_name:
            raise HTTPException(400, "Nombre obligatorio")
        upd["name"] = new_name
        if new_name != old_name:
            dup = await db.flightcases.find_one({"name": new_name, "id": {"$ne": fid}}, PROJ)
            if dup:
                raise HTTPException(400, "Ya existe un flightcase con ese nombre")
    if upd:
        await db.flightcases.update_one({"id": fid}, {"$set": upd})
    # propagate name change to event units
    if "name" in upd and new_name != old_name:
        await db.events.update_many(
            {"materials.units.flightcase": old_name},
            {"$set": {"materials.$[].units.$[u].flightcase": new_name}},
            array_filters=[{"u.flightcase": old_name}],
        )
    return await db.flightcases.find_one({"id": fid}, PROJ)


@api_router.delete("/flightcases/{fid}")
async def delete_flightcase(fid: str):
    fc = await db.flightcases.find_one({"id": fid}, PROJ)
    if not fc:
        raise HTTPException(404, "Flightcase no encontrado")
    # clear assignments on events
    await db.events.update_many(
        {"materials.units.flightcase": fc["name"]},
        {"$set": {"materials.$[].units.$[u].flightcase": ""}},
        array_filters=[{"u.flightcase": fc["name"]}],
    )
    await db.flightcases.delete_one({"id": fid})
    return {"ok": True}


# ---------- Cable distribution per flightcase ----------
@api_router.put("/events/{eid}/cable-distribution")
async def set_cable_distribution(eid: str, payload: CableDistributionRequest):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    em = next((m for m in ev.get("materials", []) if m["material_id"] == payload.material_id), None)
    if not em:
        raise HTTPException(404, "Material no bloqueado en el evento")
    cat = await get_category(em["category"])
    if cat.get("has_unit_refs", True):
        raise HTTPException(400, "Solo aplicable a categorías sin numeración por unidad (ej: cables)")
    units = list(em.get("units", []))
    total_units = len(units)
    total_dist = sum(int(v) for v in payload.distribution.values())
    if total_dist != total_units:
        raise HTTPException(400, f"La distribución suma {total_dist}, debe sumar {total_units}")
    # build flat list of fc names per unit position
    fc_per_unit: List[str] = []
    for fc_name, qty in payload.distribution.items():
        for _ in range(int(qty)):
            fc_per_unit.append(fc_name)
    # assign
    for i, u in enumerate(units):
        u["flightcase"] = fc_per_unit[i] if i < len(fc_per_unit) else ""
    await db.events.update_one(
        {"id": eid, "materials.material_id": payload.material_id},
        {"$set": {"materials.$.units": units}},
    )
    return await db.events.find_one({"id": eid}, PROJ)



@api_router.post("/events/{eid}/rentals")
async def add_rental(eid: str, payload: RentalCreate):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    provider_name = payload.provider_name
    if payload.provider_id and not provider_name:
        p = await db.providers.find_one({"id": payload.provider_id}, PROJ)
        if p:
            provider_name = p["name"]
    item = RentalItem(
        name=payload.name, quantity=payload.quantity,
        provider_id=payload.provider_id, provider_name=provider_name, notes=payload.notes,
    )
    await db.events.update_one({"id": eid}, {"$push": {"rentals": item.model_dump()}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.delete("/events/{eid}/rentals/{rid}")
async def remove_rental(eid: str, rid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    await db.events.update_one({"id": eid}, {"$pull": {"rentals": {"id": rid}}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/close")
async def close_event(eid: str):
    await db.events.update_one({"id": eid}, {"$set": {"status": "cerrado"}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/reopen")
async def reopen_event(eid: str):
    await db.events.update_one({"id": eid}, {"$set": {"status": "abierto"}})
    return await db.events.find_one({"id": eid}, PROJ)


# ---------- Packs ----------
@api_router.get("/packs", response_model=List[Pack])
async def list_packs():
    return await db.packs.find({}, PROJ).sort("name", 1).to_list(500)


@api_router.post("/packs", response_model=Pack)
async def create_pack(payload: PackCreate):
    p = Pack(**payload.model_dump())
    await db.packs.insert_one(p.model_dump())
    return p


@api_router.put("/packs/{pid}", response_model=Pack)
async def update_pack(pid: str, payload: PackCreate):
    res = await db.packs.find_one_and_update({"id": pid}, {"$set": payload.model_dump()}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Pack not found")
    return res


@api_router.delete("/packs/{pid}")
async def delete_pack(pid: str):
    await db.packs.delete_one({"id": pid})
    return {"ok": True}


@api_router.post("/events/{eid}/apply-pack/{pid}")
async def apply_pack(eid: str, pid: str):
    pack = await db.packs.find_one({"id": pid}, PROJ)
    if not pack:
        raise HTTPException(404, "Pack not found")
    results = []
    for it in pack.get("items", []):
        try:
            await block_material(eid, BlockMaterialRequest(material_id=it["material_id"], quantity=it["quantity"]))
            results.append({"material_id": it["material_id"], "ok": True})
        except HTTPException as e:
            results.append({"material_id": it["material_id"], "ok": False, "error": e.detail})
    ev = await db.events.find_one({"id": eid}, PROJ)
    return {"event": ev, "results": results}


# ---------- Incidents ----------
@api_router.post("/incidents")
async def create_incident(payload: IncidentCreate):
    u = await db.units.find_one({"id": payload.unit_id}, PROJ)
    if not u:
        raise HTTPException(404, "Unit not found")
    # ensure unit is not blocked in any event
    async for ev in db.events.find({}, PROJ):
        for em in ev.get("materials", []):
            for unit in em.get("units", []):
                if unit["unit_id"] == payload.unit_id:
                    raise HTTPException(400, "Unidad bloqueada en evento. Libera primero.")
    await db.units.update_one({"id": payload.unit_id}, {"$set": {"status": payload.status}})
    log = IncidentLog(
        unit_id=payload.unit_id, type="report", status=payload.status,
        description=payload.description, files=payload.files,
    )
    await db.incident_logs.insert_one(log.model_dump())
    return log


@api_router.get("/incidents")
async def list_incidents():
    """Returns units currently in broken/repair status, with their latest log."""
    units = await db.units.find({"status": {"$in": ["broken", "repair"]}}, PROJ).to_list(2000)
    out = []
    for u in units:
        m = await db.materials.find_one({"id": u["material_id"]}, PROJ)
        latest = await db.incident_logs.find({"unit_id": u["id"]}, PROJ).sort("created_at", -1).to_list(1)
        out.append({
            "unit": u,
            "material": {"id": m["id"], "name": m["name"], "category": m["category"], "reference": m["reference"]} if m else None,
            "latest": latest[0] if latest else None,
        })
    return out


@api_router.get("/units/{unit_id}/history")
async def unit_history(unit_id: str):
    logs = await db.incident_logs.find({"unit_id": unit_id}, PROJ).sort("created_at", -1).to_list(500)
    return logs


@api_router.post("/incidents/{unit_id}/resolve")
async def resolve_incident(unit_id: str, payload: IncidentResolve):
    u = await db.units.find_one({"id": unit_id}, PROJ)
    if not u:
        raise HTTPException(404, "Unit not found")
    await db.units.update_one({"id": unit_id}, {"$set": {"status": "available"}})
    log = IncidentLog(
        unit_id=unit_id, type="resolve", status="available",
        description=payload.description, files=payload.files,
    )
    await db.incident_logs.insert_one(log.model_dump())
    return log


@api_router.post("/incidents/{unit_id}/update")
async def update_incident(unit_id: str, payload: IncidentResolve):
    log = IncidentLog(
        unit_id=unit_id, type="update",
        status=(await db.units.find_one({"id": unit_id}, PROJ) or {}).get("status", ""),
        description=payload.description, files=payload.files,
    )
    await db.incident_logs.insert_one(log.model_dump())
    return log


# ---------- File upload ----------
@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    fid = str(uuid.uuid4())
    path = f"{APP_NAME}/uploads/{fid}.{ext}"
    data = await file.read()
    res = put_object(path, data, file.content_type or "application/octet-stream")
    rec = {
        "id": fid, "storage_path": res["path"], "name": file.filename,
        "content_type": file.content_type, "size": res["size"],
        "created_at": datetime.now(timezone.utc).isoformat(), "is_deleted": False,
    }
    await db.files.insert_one(rec)
    return {"id": fid, "path": res["path"], "name": file.filename, "content_type": file.content_type, "size": res["size"]}


@api_router.get("/files/{path:path}")
async def download_file(path: str):
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not rec:
        raise HTTPException(404, "File not found")
    data, ct = get_object(path)
    return Response(content=data, media_type=rec.get("content_type", ct))


# ---------- PDF ----------
def _fmt_dt(s):
    if not s:
        return "—"
    d = parse_dt(s)
    if not d:
        return s
    return d.strftime("%d/%m/%Y %H:%M") if "T" in str(s) else d.strftime("%d/%m/%Y")


def _build_pdf(event: dict, subitem_name_map: dict = None) -> bytes:
    subitem_name_map = subitem_name_map or {}
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
                            topMargin=1.5 * cm, bottomMargin=2 * cm,
                            title=f"Evento {event.get('name','')}")
    styles = getSampleStyleSheet()
    body = styles["Normal"]
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#b45309"),
                        spaceBefore=14, spaceAfter=6, fontName="Helvetica-Bold")
    sub_body = ParagraphStyle("subbody", parent=body, fontSize=9, fontName="Helvetica-Oblique",
                              textColor=colors.HexColor("#57534e"), leftIndent=18)
    story = []

    if LOGO_PATH.exists():
        try:
            ir = ImageReader(str(LOGO_PATH))
            iw, ih = ir.getSize()
            aspect = ih / iw
            target_w = 4 * cm
            target_h = target_w * aspect
            max_h = 2 * cm
            if target_h > max_h:
                target_h = max_h
                target_w = target_h / aspect
            logo = Image(str(LOGO_PATH), width=target_w, height=target_h)
            logo.hAlign = "LEFT"
            type_label = "BOLO" if event.get("type") == "bolo" else "ALQUILER"
            status_label = "Cerrado" if event.get("status") == "cerrado" else "Abierto"
            head_right = Paragraph(
                f"<b>{event.get('name','Evento')}</b><br/><font size=9 color='#78716c'>{type_label} · {status_label}</font>",
                ParagraphStyle("hr", parent=body, fontSize=14, alignment=2)
            )
            head_tbl = Table([[logo, head_right]], colWidths=[4.5 * cm, 12 * cm])
            head_tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#1c1917")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]))
            story.append(head_tbl)
            story.append(Spacer(1, 8))
        except Exception:
            pass

    info_rows = [
        ["Cliente", event.get("client_name") or "—"],
        ["Contacto", event.get("client_contact") or "—"],
        ["Referencia", event.get("reference") or "—"],
        ["Ubicación", event.get("location") or "—"],
    ]
    if event.get("type") == "bolo":
        info_rows += [
            ["Salida nave", _fmt_dt(event.get("warehouse_out_dt"))],
            ["Montaje", f'{_fmt_dt(event.get("setup_start_dt"))}  →  {_fmt_dt(event.get("setup_end_dt"))}'],
            ["Acto", f'{_fmt_dt(event.get("act_start_dt"))}  →  {_fmt_dt(event.get("act_end_dt"))}'],
            ["Desmontaje", f'{_fmt_dt(event.get("dismount_start_dt"))}  →  {_fmt_dt(event.get("dismount_end_dt"))}'],
        ]
    else:
        info_rows += [
            ["Salida nave", _fmt_dt(event.get("warehouse_out_dt"))],
            ["Retorno", _fmt_dt(event.get("return_dt"))],
        ]
    info_rows += [["Fecha acto", event.get("event_date") or "—"], ["Horarios", event.get("schedule") or "—"]]
    info_tbl = Table(info_rows, colWidths=[4 * cm, 12 * cm])
    info_tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
    ]))
    story.append(info_tbl)

    if event.get("notes"):
        story.append(Paragraph("Notas", h2))
        story.append(Paragraph(event["notes"].replace("\n", "<br/>"), body))

    materials = event.get("materials", [])
    if materials:
        story.append(Paragraph("Material bloqueado del stock", h2))
        by_cat: Dict[str, List[dict]] = {}
        for m in materials:
            by_cat.setdefault(m["category"], []).append(m)
        cat_order = subitem_name_map.get("__cat_order__") or list(by_cat.keys())
        for cat in cat_order:
            if cat in by_cat:
                cat_label = subitem_name_map.get(f"__cat_label__{cat}", cat.capitalize())
                cat_has_unit_refs = subitem_name_map.get(f"__cat_unit_refs__{cat}", True)
                story.append(Paragraph(cat_label, ParagraphStyle(
                    "cat", parent=body, fontSize=11, textColor=colors.HexColor("#111827"),
                    spaceBefore=4, spaceAfter=2, fontName="Helvetica-Bold")))
                for m in sorted(by_cat[cat], key=lambda x: x.get("reference") or x["name"]):
                    units = m.get("units", [])
                    head = f"<b>{m.get('reference','') + ' · ' if m.get('reference') else ''}{m['name']}</b> &nbsp;<font color='#78716c'>x{len(units)}</font>"
                    story.append(Paragraph(head, ParagraphStyle("ml", parent=body, fontSize=10, spaceBefore=3, spaceAfter=1)))
                    if cat_has_unit_refs:
                        for u in units:
                            story.append(Paragraph(f"&nbsp;&nbsp;• <font face='Courier' size=9 color='#b45309'>{u['reference']}</font>",
                                                   ParagraphStyle("ul", parent=body, fontSize=10, leftIndent=12)))
                            for s in u.get("subitems", []):
                                if s.get("type") == "unit":
                                    ref = s.get("unit_reference") or ""
                                    stored = s.get("name", "")
                                    resolved = subitem_name_map.get(s.get("unit_id"), stored if stored and not stored.startswith("(") else "")
                                    story.append(Paragraph(f"↳ <font face='Courier' color='#b45309'>({ref})</font> [{resolved}] <font color='#78716c'>x{s.get('qty',1)}</font>", sub_body))
                                else:
                                    story.append(Paragraph(f"↳ {s.get('name','')} <font color='#78716c'>x{s.get('qty',1)}</font>", sub_body))
                    else:
                        # group by flightcase for non-unit-ref categories (cables)
                        fc_counts: Dict[str, int] = {}
                        for u in units:
                            fc = u.get("flightcase") or ""
                            fc_counts[fc] = fc_counts.get(fc, 0) + 1
                        if len(fc_counts) > 1 or (len(fc_counts) == 1 and "" not in fc_counts):
                            for fc_name in sorted(fc_counts.keys(), key=lambda x: (x == "", x)):
                                qty = fc_counts[fc_name]
                                label = fc_name if fc_name else "Sin flightcase"
                                story.append(Paragraph(
                                    f"&nbsp;&nbsp;• <font color='#57534e'>{label}</font> <font color='#78716c'>x{qty}</font>",
                                    ParagraphStyle("fc", parent=body, fontSize=10, leftIndent=12),
                                ))

    rentals = event.get("rentals", [])
    if rentals:
        story.append(Paragraph("Material de alquiler externo", h2))
        rows = [["Material", "Proveedor", "Cant.", "Notas"]]
        for r in rentals:
            rows.append([r["name"], r.get("provider_name") or "—", str(r["quantity"]), r.get("notes") or ""])
        t = Table(rows, colWidths=[6 * cm, 4.5 * cm, 1.5 * cm, 4 * cm])
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fef3c7")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
        ]))
        story.append(t)

    if not materials and not rentals:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Sin material asignado.", body))

    if event.get("type") == "alquiler":
        story.append(Spacer(1, 30))
        story.append(Paragraph("<b>Conformidad y firma del cliente</b>", h2))
        story.append(Paragraph(
            "El cliente declara haber recibido el material en buen estado y se compromete a su devolución en las mismas condiciones.",
            ParagraphStyle("decl", parent=body, fontSize=9, textColor=colors.HexColor("#57534e"))))
        story.append(Spacer(1, 10))
        sig = Table([["Nombre y DNI", "Firma"], ["", ""]],
                    colWidths=[8 * cm, 8 * cm], rowHeights=[0.7 * cm, 3 * cm])
        sig.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
            ("BOX", (0, 1), (0, 1), 0.5, colors.HexColor("#1c1917")),
            ("BOX", (1, 1), (1, 1), 0.5, colors.HexColor("#1c1917")),
        ]))
        story.append(sig)
        story.append(Spacer(1, 6))
        story.append(Paragraph("Fecha: ____ / ____ / ________",
                               ParagraphStyle("sigd", parent=body, fontSize=10, textColor=colors.HexColor("#57534e"))))

    story.append(Spacer(1, 18))
    story.append(Paragraph(
        f"Generado el {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')} · Edison",
        ParagraphStyle("foot", parent=body, fontSize=8, textColor=colors.HexColor("#9ca3af"))))

    doc.build(story)
    return buf.getvalue()


@api_router.get("/events/{eid}/export")
async def export_event_pdf(eid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    # build subitem name map: unit_id -> material name
    sub_unit_ids = set()
    for em in ev.get("materials", []):
        for u in em.get("units", []):
            for s in u.get("subitems", []):
                if s.get("type") == "unit" and s.get("unit_id"):
                    sub_unit_ids.add(s["unit_id"])
    name_map = {}
    if sub_unit_ids:
        sub_units = await db.units.find({"id": {"$in": list(sub_unit_ids)}}, PROJ).to_list(5000)
        sub_mat_ids = list({u["material_id"] for u in sub_units})
        sub_mats = await db.materials.find({"id": {"$in": sub_mat_ids}}, PROJ).to_list(5000)
        mat_by_id = {m["id"]: m for m in sub_mats}
        for u in sub_units:
            m = mat_by_id.get(u["material_id"])
            if m:
                name_map[u["id"]] = m["name"]
    # add category metadata
    cats = await db.categories.find({}, PROJ).sort("order", 1).to_list(200)
    name_map["__cat_order__"] = [c["key"] for c in cats]
    for c in cats:
        name_map[f"__cat_label__{c['key']}"] = c["label"]
        name_map[f"__cat_unit_refs__{c['key']}"] = c.get("has_unit_refs", True)
    pdf_bytes = _build_pdf(ev, subitem_name_map=name_map)
    filename = f"evento_{(ev.get('reference') or ev.get('name','evento')).replace(' ', '_')}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------- Stats ----------
@api_router.get("/stats")
async def stats():
    total_materials = await db.materials.count_documents({})
    total_units = await db.units.count_documents({})
    total_events = await db.events.count_documents({})
    open_events = await db.events.count_documents({"status": "abierto"})
    closed_events = await db.events.count_documents({"status": "cerrado"})
    incidents = await db.units.count_documents({"status": {"$in": ["broken", "repair"]}})
    by_cat_cursor = db.materials.aggregate([
        {"$group": {"_id": "$category", "count": {"$sum": 1}, "qty": {"$sum": "$quantity"}}}
    ])
    by_cat = {}
    async for row in by_cat_cursor:
        by_cat[row["_id"]] = {"count": row["count"], "qty": row["qty"]}
    return {
        "total_materials": total_materials,
        "total_units": total_units,
        "total_events": total_events,
        "open_events": open_events,
        "closed_events": closed_events,
        "incidents": incidents,
        "by_category": by_cat,
    }


@api_router.get("/")
async def root():
    return {"app": "Stock Eventos", "ok": True}


app.include_router(api_router)

app.add_middleware(CORSMiddleware, allow_credentials=True,
                   allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
                   allow_methods=["*"], allow_headers=["*"])

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def on_startup():
    init_storage()
    await seed_and_migrate()
    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
