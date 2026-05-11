from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Depends, Request, Query
from fastapi.responses import StreamingResponse, Response, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import io
import logging
import unicodedata
import requests as http_requests
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.utils import ImageReader

from auth import (
    User, UserPublic, LoginRequest, RegisterRequest, UpdateUserRequest,
    ChangePasswordRequest, ForgotPasswordRequest, ResetPasswordRequest, ROLES,
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, set_auth_cookies, clear_auth_cookies, make_auth_dependencies,
    gen_reset_token,
)
from emailer import send_email, render_basic
import jwt as _jwt


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
LOGO_PATH = ROOT_DIR / "assets" / "logo.png"

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# auth dependencies (must be available for route decorators below)
get_current_user, require_role = make_auth_dependencies(db)
require_productor = require_role("productor")
require_warehouse = require_role("productor", "almacen")
require_almacen = require_role("almacen")
require_taller = require_role("taller")
require_any = require_role("productor", "almacen", "tecnico")


def _normalize_login(s: str) -> str:
    """Lowercase + strip accents. Used to match login usernames like 'Almacén' -> 'almacen'."""
    if not s:
        return ""
    s = s.strip().lower()
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _strip_accents(s: str) -> str:
    """Strip accents preserving case (for password tolerance on protected accounts)."""
    if not s:
        return ""
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


async def _assert_event_modifiable(eid: str) -> dict:
    """Return event if it can be modified; raise if closed or prep-locked."""
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    if ev.get("prep_status") == "preparado":
        raise HTTPException(423, "Evento bloqueado por Almacén. Desbloquéalo para hacer cambios.")
    return ev


def _prep_log_entry(action: str, by_user: dict, **extra) -> dict:
    import uuid as _uuid
    return {
        "id": str(_uuid.uuid4()),
        "action": action,
        "at": datetime.now(timezone.utc).isoformat(),
        "by_user_id": by_user.get("id"),
        "by_user_name": by_user.get("name") or by_user.get("email", ""),
        **extra,
    }

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


class EventVehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["owned", "rental"] = "owned"
    vehicle_id: Optional[str] = None
    name: str = ""
    plate: str = ""
    notes: str = ""


class ExpenseFile(BaseModel):
    file_id: str
    name: str = ""
    content_type: str = ""


class Expense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str
    amount: float
    currency: str = "EUR"
    files: List[ExpenseFile] = []
    created_by: str = ""
    created_by_name: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


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
    vehicles: List[EventVehicle] = []
    assigned_technicians: List[str] = []
    responsible_technician_id: Optional[str] = None
    tech_notes: Dict[str, str] = Field(default_factory=dict)
    expenses: List[Expense] = []
    prep_status: Literal["pendiente", "preparado"] = "pendiente"
    prep_checks: List[str] = []  # unit ids marked as prepared by almacen
    prep_locked_at: Optional[str] = None
    prep_locked_by: Optional[str] = None
    prep_locked_by_name: str = ""
    prep_log: List[Dict[str, Any]] = []
    # Alquileres only — delivery & return
    delivery: Optional[Dict[str, Any]] = None
    return_info: Optional[Dict[str, Any]] = None
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
    assigned_technicians: List[str] = []
    responsible_technician_id: Optional[str] = None
    tech_notes: Optional[Dict[str, str]] = None


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


class Vehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    plate: str
    status: UnitStatus = "available"  # available|broken|repair
    notes: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VehicleCreate(BaseModel):
    name: str
    plate: str
    notes: str = ""


class VehicleUpdate(BaseModel):
    name: Optional[str] = None
    plate: Optional[str] = None
    notes: Optional[str] = None


class EventVehicleAdd(BaseModel):
    type: Literal["owned", "rental"] = "owned"
    vehicle_id: Optional[str] = None
    name: str = ""
    plate: str = ""
    notes: str = ""


class IncidentCreate(BaseModel):
    unit_id: Optional[str] = None
    vehicle_id: Optional[str] = None
    status: Literal["broken", "repair"] = "broken"
    description: str
    files: List[Dict[str, Any]] = []  # [{path, name, content_type}]


class IncidentLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    unit_id: Optional[str] = None
    vehicle_id: Optional[str] = None
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


# ---------- Independent tasks ----------
class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    kind: Literal["transport", "warehouse", "visit", "other"] = "other"
    start_dt: str
    end_dt: Optional[str] = None
    location: str = ""
    notes: str = ""
    assigned_technicians: List[str] = []
    related_event_id: Optional[str] = None
    files: List[ExpenseFile] = []
    created_by: str = ""
    created_by_name: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskCreate(BaseModel):
    title: str
    kind: Literal["transport", "warehouse", "visit", "other"] = "other"
    start_dt: str
    end_dt: Optional[str] = None
    location: str = ""
    notes: str = ""
    assigned_technicians: List[str] = []
    related_event_id: Optional[str] = None
    files: List[ExpenseFile] = []


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    kind: Optional[Literal["transport", "warehouse", "visit", "other"]] = None
    start_dt: Optional[str] = None
    end_dt: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    assigned_technicians: Optional[List[str]] = None
    related_event_id: Optional[str] = None
    files: Optional[List[ExpenseFile]] = None


class ExpenseCreate(BaseModel):
    description: str
    amount: float
    currency: str = "EUR"
    files: List[ExpenseFile] = []


class TechAssignmentRequest(BaseModel):
    assigned_technicians: List[str] = []
    responsible_technician_id: Optional[str] = None
    tech_notes: Optional[Dict[str, str]] = None


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

    # seed default vehicles if empty
    if await db.vehicles.count_documents({}) == 0:
        for v in [
            {"name": "Renault", "plate": "3880LTX"},
            {"name": "Jumper", "plate": "2904KXT"},
            {"name": "Opel", "plate": "9737KHM"},
        ]:
            await db.vehicles.insert_one(Vehicle(**v).model_dump())

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
async def list_categories(user: dict = Depends(get_current_user)):
    return await db.categories.find({}, PROJ).sort("order", 1).to_list(200)


@api_router.post("/categories", response_model=CategoryModel)
async def create_category(payload: CategoryCreate, _u: dict = Depends(require_warehouse)):
    if await db.categories.find_one({"key": payload.key}):
        raise HTTPException(400, "Esta clave ya existe")
    last = await db.categories.find({}, PROJ).sort("order", -1).limit(1).to_list(1)
    order = (last[0]["order"] if last else 0) + 1
    c = CategoryModel(**payload.model_dump(), order=order)
    await db.categories.insert_one(c.model_dump())
    return c


@api_router.put("/categories/{key}")
async def update_category(key: str, payload: CategoryUpdate, _u: dict = Depends(require_warehouse)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "Sin cambios")
    res = await db.categories.find_one_and_update({"key": key}, {"$set": update}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Categoría no encontrada")
    return res


@api_router.delete("/categories/{key}")
async def delete_category(key: str, _u: dict = Depends(require_warehouse)):
    if await db.materials.count_documents({"category": key}) > 0:
        raise HTTPException(400, "Hay materiales en esta categoría. Muévelos primero.")
    await db.categories.delete_one({"key": key})
    return {"ok": True}


# ---------- Vehicles ----------
async def _vehicle_with_counts(v: dict) -> dict:
    v["incident_count"] = await db.incident_logs.count_documents({"vehicle_id": v["id"], "type": "report"})
    return v


@api_router.get("/vehicles")
async def list_vehicles(user: dict = Depends(get_current_user)):
    items = await db.vehicles.find({}, PROJ).sort("name", 1).to_list(500)
    for v in items:
        await _vehicle_with_counts(v)
    return items


@api_router.post("/vehicles", response_model=Vehicle)
async def create_vehicle(payload: VehicleCreate, _u: dict = Depends(require_warehouse)):
    name = payload.name.strip()
    plate = payload.plate.strip().upper()
    if not name or not plate:
        raise HTTPException(400, "Nombre y matrícula obligatorios")
    if await db.vehicles.find_one({"plate": plate}, PROJ):
        raise HTTPException(400, "Ya existe un vehículo con esa matrícula")
    v = Vehicle(name=name, plate=plate, notes=payload.notes)
    await db.vehicles.insert_one(v.model_dump())
    return v


@api_router.put("/vehicles/{vid}", response_model=Vehicle)
async def update_vehicle(vid: str, payload: VehicleUpdate, _u: dict = Depends(require_warehouse)):
    v = await db.vehicles.find_one({"id": vid}, PROJ)
    if not v:
        raise HTTPException(404, "Vehículo no encontrado")
    upd = {k: val for k, val in payload.model_dump(exclude_none=True).items()}
    if "plate" in upd:
        upd["plate"] = upd["plate"].strip().upper()
        dup = await db.vehicles.find_one({"plate": upd["plate"], "id": {"$ne": vid}}, PROJ)
        if dup:
            raise HTTPException(400, "Ya existe un vehículo con esa matrícula")
    if upd:
        await db.vehicles.update_one({"id": vid}, {"$set": upd})
    return await db.vehicles.find_one({"id": vid}, PROJ)


@api_router.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, _u: dict = Depends(require_warehouse)):
    v = await db.vehicles.find_one({"id": vid}, PROJ)
    if not v:
        raise HTTPException(404, "Vehículo no encontrado")
    # block delete if used in any event
    used = await db.events.count_documents({"vehicles.vehicle_id": vid})
    if used:
        raise HTTPException(400, f"En uso en {used} evento(s). Quítalo de los eventos primero.")
    await db.vehicles.delete_one({"id": vid})
    return {"ok": True}


# ---------- Materials & Units ----------
@api_router.get("/materials")
async def list_materials(category: Optional[str] = None, q: Optional[str] = None, user: dict = Depends(get_current_user)):
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
    # enrich with blocked + units count + incident count
    for it in items:
        it["blocked"] = await material_blocked_count(it["id"])
        it["unit_count"] = await db.units.count_documents({"material_id": it["id"]})
        unit_ids = [u["id"] for u in await db.units.find({"material_id": it["id"]}, PROJ).to_list(2000)]
        it["incident_count"] = await db.incident_logs.count_documents({"unit_id": {"$in": unit_ids}, "type": "report"}) if unit_ids else 0
    return items


@api_router.post("/materials", response_model=Material)
async def create_material(payload: MaterialCreate, _u: dict = Depends(require_warehouse)):
    data = payload.model_dump()
    if not data.get("reference"):
        data["reference"] = await next_base_reference(data["category"])
    m = Material(**data)
    await db.materials.insert_one(m.model_dump())
    if data.get("quantity", 0) > 0:
        await create_units_for_material(m.model_dump(), data["quantity"])
    return m


@api_router.put("/materials/{material_id}", response_model=Material)
async def update_material(material_id: str, payload: MaterialUpdate, _u: dict = Depends(require_warehouse)):
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
async def delete_material(material_id: str, _u: dict = Depends(require_warehouse)):
    m = await db.materials.find_one({"id": material_id}, PROJ)
    if not m:
        raise HTTPException(404, "Material not found")
    if await material_blocked_count(material_id) > 0:
        raise HTTPException(400, "Material con unidades bloqueadas o en avería. Libera primero.")
    await db.units.delete_many({"material_id": material_id})
    await db.materials.delete_one({"id": material_id})
    return {"ok": True}


@api_router.get("/units")
async def list_units(material_id: Optional[str] = None, status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if material_id:
        q["material_id"] = material_id
    if status:
        q["status"] = status
    units = await db.units.find(q, PROJ).sort("seq", 1).to_list(10000)
    return units


@api_router.post("/materials/{material_id}/units", response_model=MaterialUnit)
async def add_unit(material_id: str, _u: dict = Depends(require_warehouse)):
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
async def update_unit(unit_id: str, payload: UnitUpdate, _u: dict = Depends(require_warehouse)):
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
async def delete_unit(unit_id: str, _u: dict = Depends(require_warehouse)):
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
async def list_providers(user: dict = Depends(get_current_user)):
    return await db.providers.find({}, PROJ).sort("name", 1).to_list(1000)


@api_router.post("/providers", response_model=Provider)
async def create_provider(payload: ProviderCreate, _u: dict = Depends(require_warehouse)):
    p = Provider(**payload.model_dump())
    await db.providers.insert_one(p.model_dump())
    return p


@api_router.put("/providers/{pid}", response_model=Provider)
async def update_provider(pid: str, payload: ProviderCreate, _u: dict = Depends(require_warehouse)):
    res = await db.providers.find_one_and_update({"id": pid}, {"$set": payload.model_dump()}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Provider not found")
    return res


@api_router.delete("/providers/{pid}")
async def delete_provider(pid: str, _u: dict = Depends(require_warehouse)):
    p = await db.providers.find_one({"id": pid}, PROJ)
    if not p:
        raise HTTPException(404, "Provider not found")
    await db.providers.delete_one({"id": pid})
    return {"ok": True}


# ---------- Events ----------
@api_router.get("/events", response_model=List[Event])
async def list_events(user: dict = Depends(get_current_user)):
    query = {}
    if user.get("role") == "tecnico":
        query = {"assigned_technicians": user["id"]}
    return await db.events.find(query, PROJ).sort("event_date", 1).to_list(5000)


@api_router.get("/events/{eid}", response_model=Event)
async def get_event(eid: str, user: dict = Depends(get_current_user)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if user.get("role") == "tecnico" and user["id"] not in (ev.get("assigned_technicians") or []):
        raise HTTPException(403, "Sin acceso a este evento")
    return ev


@api_router.post("/events", response_model=Event)
async def create_event(payload: EventCreate, _u: dict = Depends(require_productor)):
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    e = Event(**data)
    await db.events.insert_one(e.model_dump())
    return e


@api_router.post("/events/bulk")
async def bulk_create_events(payload: BulkEventsRequest, _u: dict = Depends(require_productor)):
    docs = [Event(**{k: v for k, v in ec.model_dump().items() if v is not None}).model_dump() for ec in payload.events]
    if docs:
        await db.events.insert_many(docs)
    return {"created": len(docs)}


@api_router.put("/events/{eid}", response_model=Event)
async def update_event(eid: str, payload: EventUpdate, _u: dict = Depends(require_productor)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    prev = await db.events.find_one({"id": eid}, PROJ)
    if not prev:
        raise HTTPException(404, "Event not found")
    res = await db.events.find_one_and_update({"id": eid}, {"$set": update}, return_document=True, projection=PROJ)
    # notify newly-assigned technicians
    try:
        prev_set = set(prev.get("assigned_technicians") or [])
        new_set = set(res.get("assigned_technicians") or [])
        added = new_set - prev_set
        if added:
            for tid in added:
                tech = await db.users.find_one({"id": tid, "active": True}, PROJ)
                if not tech:
                    continue
                public_url = os.environ.get("APP_PUBLIC_URL", "")
                ev_url = f"{public_url}/eventos/{eid}"
                date_str = res.get("event_date") or res.get("setup_date") or ""
                tech_note = (res.get("tech_notes") or {}).get(tid) or ""
                note_html = ""
                if tech_note:
                    safe_note = tech_note.replace("\n", "<br>")
                    note_html = (
                        "<br><br><div style='border-left:3px solid #b45309;padding:8px 12px;"
                        "background:#fffbeb;color:#78350f;'>"
                        f"<b>Nota privada del productor:</b><br>{safe_note}</div>"
                    )
                body = (f"Hola {tech.get('name') or tech['email']}, has sido asignado al evento "
                        f"<b>{res.get('name','')}</b>.<br><br>"
                        f"<b>Fecha:</b> {date_str}<br>"
                        f"<b>Ubicación:</b> {res.get('location') or '—'}<br>"
                        f"<b>Cliente:</b> {res.get('client_name') or '—'}<br>"
                        f"<b>Horarios:</b> {res.get('schedule') or '—'}"
                        f"{note_html}")
                html = render_basic(
                    title="Te han asignado a un evento",
                    body_html=body,
                    cta_label="Ver detalles",
                    cta_url=ev_url,
                    footer="Edison Rent",
                )
                await send_email(tech["email"], f"Asignación: {res.get('name','evento')}", html)
    except Exception as e:
        logger.error("technician notify error: %s", e)
    return res


@api_router.delete("/events/{eid}")
async def delete_event(eid: str, _u: dict = Depends(require_productor)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    await db.events.delete_one({"id": eid})
    return {"ok": True}


async def _compute_availability(eid: str, material_id: str):
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


# ---------- Material availability for an event ----------
@api_router.get("/events/{eid}/availability")
async def event_availability(eid: str, material_id: str, user: dict = Depends(get_current_user)):
    """Return list of available units for given material in the event's time window."""
    return await _compute_availability(eid, material_id)


# ---------- Block / unblock material ----------
async def _block_units(eid: str, material_id: str, unit_ids: List[str]):
    ev = await _assert_event_modifiable(eid)
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
async def block_material(eid: str, payload: BlockMaterialRequest, _u: dict = Depends(require_warehouse)):
    await _assert_event_modifiable(eid)
    if payload.unit_ids:
        return await _block_units(eid, payload.material_id, payload.unit_ids)
    if payload.quantity is None or payload.quantity < 0:
        raise HTTPException(400, "quantity o unit_ids requerido")
    if payload.quantity == 0:
        # treat as unblock
        await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": payload.material_id}}})
        return await db.events.find_one({"id": eid}, PROJ)
    # auto-pick available units
    avail = await _compute_availability(eid, payload.material_id)
    avail_units = [u for u in avail["units"] if u["available"]]
    if len(avail_units) < payload.quantity:
        raise HTTPException(400, f"Solo {len(avail_units)} unidades disponibles, pides {payload.quantity}")
    chosen = [u["id"] for u in avail_units[: payload.quantity]]
    return await _block_units(eid, payload.material_id, chosen)


@api_router.delete("/events/{eid}/materials/{material_id}")
async def unblock_material(eid: str, material_id: str, _u: dict = Depends(require_warehouse)):
    await _assert_event_modifiable(eid)
    await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": material_id}}})
    # also clean prep_checks of units that belonged to this material
    ev = await db.events.find_one({"id": eid}, PROJ)
    return ev


# ---------- Flightcases (library) ----------
@api_router.get("/flightcases", response_model=List[Flightcase])
async def list_flightcases(user: dict = Depends(get_current_user)):
    items = await db.flightcases.find({}, PROJ).sort("name", 1).to_list(1000)
    return items


@api_router.post("/flightcases", response_model=Flightcase)
async def create_flightcase(payload: FlightcaseCreate, _u: dict = Depends(require_warehouse)):
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
async def update_flightcase(fid: str, payload: FlightcaseUpdate, _u: dict = Depends(require_warehouse)):
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
async def delete_flightcase(fid: str, _u: dict = Depends(require_warehouse)):
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
async def set_cable_distribution(eid: str, payload: CableDistributionRequest, _u: dict = Depends(require_warehouse)):
    ev = await _assert_event_modifiable(eid)
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
async def add_rental(eid: str, payload: RentalCreate, _u: dict = Depends(require_warehouse)):
    await _assert_event_modifiable(eid)
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
async def remove_rental(eid: str, rid: str, _u: dict = Depends(require_warehouse)):
    await _assert_event_modifiable(eid)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    await db.events.update_one({"id": eid}, {"$pull": {"rentals": {"id": rid}}})
    return await db.events.find_one({"id": eid}, PROJ)


# ---------- Event vehicles ----------
@api_router.get("/events/{eid}/vehicle-availability")
async def event_vehicle_availability(eid: str):
    """List of owned vehicles with availability status for the event window."""
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    cw = event_window(ev)
    others = await db.events.find({"id": {"$ne": eid}}, PROJ).to_list(5000)
    busy_ids: set = set()
    for oev in others:
        if overlaps(cw, event_window(oev)):
            for v in oev.get("vehicles", []):
                if v.get("type") == "owned" and v.get("vehicle_id"):
                    busy_ids.add(v["vehicle_id"])
    out = []
    for v in await db.vehicles.find({}, PROJ).sort("name", 1).to_list(500):
        reason = None
        if v.get("status") == "broken":
            reason = "averiado"
        elif v.get("status") == "repair":
            reason = "en reparación"
        elif v["id"] in busy_ids:
            reason = "ocupado en otro evento"
        out.append({**v, "available": reason is None, "reason": reason})
    return out


@api_router.post("/events/{eid}/vehicles")
async def add_event_vehicle(eid: str, payload: EventVehicleAdd, _u: dict = Depends(require_warehouse)):
    await _assert_event_modifiable(eid)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    if payload.type == "owned":
        if not payload.vehicle_id:
            raise HTTPException(400, "vehicle_id requerido para tipo owned")
        veh = await db.vehicles.find_one({"id": payload.vehicle_id}, PROJ)
        if not veh:
            raise HTTPException(404, "Vehículo no encontrado")
        if veh.get("status") in ("broken", "repair"):
            raise HTTPException(400, f"Vehículo {veh['name']} {veh['plate']} en estado {veh['status']}")
        # check overlap
        cw = event_window(ev)
        for oev in await db.events.find({"id": {"$ne": eid}}, PROJ).to_list(5000):
            if overlaps(cw, event_window(oev)):
                for ov in oev.get("vehicles", []):
                    if ov.get("type") == "owned" and ov.get("vehicle_id") == payload.vehicle_id:
                        raise HTTPException(400, f"Vehículo ocupado en {oev.get('name','otro evento')}")
        # avoid double-add in same event
        for ov in ev.get("vehicles", []):
            if ov.get("type") == "owned" and ov.get("vehicle_id") == payload.vehicle_id:
                raise HTTPException(400, "Ya está añadido a este evento")
        item = EventVehicle(type="owned", vehicle_id=payload.vehicle_id, name=veh["name"], plate=veh["plate"], notes=payload.notes)
    else:
        if not payload.name.strip():
            raise HTTPException(400, "Nombre del vehículo de alquiler obligatorio")
        item = EventVehicle(type="rental", name=payload.name.strip(), plate=payload.plate.strip().upper(), notes=payload.notes)
    await db.events.update_one({"id": eid}, {"$push": {"vehicles": item.model_dump()}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.delete("/events/{eid}/vehicles/{vid}")
async def remove_event_vehicle(eid: str, vid: str, _u: dict = Depends(require_warehouse)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    await db.events.update_one({"id": eid}, {"$pull": {"vehicles": {"id": vid}}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/close")
async def close_event(eid: str, _u: dict = Depends(require_warehouse)):
    await db.events.update_one({"id": eid}, {"$set": {"status": "cerrado"}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/reopen")
async def reopen_event(eid: str, _u: dict = Depends(require_warehouse)):
    await db.events.update_one({"id": eid}, {"$set": {"status": "abierto"}})
    return await db.events.find_one({"id": eid}, PROJ)


# ---------- Preparación (Almacén) ----------
class PrepCheckUnitRequest(BaseModel):
    unit_id: str
    checked: bool


class PrepSubstituteRequest(BaseModel):
    material_id: str
    old_unit_id: str
    new_unit_id: str
    # Optional: when substituting across materials, target material of the new unit
    new_material_id: Optional[str] = None


class PrepRemoveRequest(BaseModel):
    material_id: str
    unit_id: str


class PrepCheckBatchRequest(BaseModel):
    unit_ids: List[str]
    checked: bool


def _is_almacen(user: dict) -> bool:
    return user.get("role") == "almacen"


def _prep_locked_block_unless_almacen(ev: dict, user: dict):
    """Prep section is editable only by Almacén. Lock state ignored here (handled by ops)."""
    if not _is_almacen(user):
        raise HTTPException(403, "Solo Almacén puede modificar la preparación")


@api_router.post("/events/{eid}/prep/check-unit")
async def prep_check_unit(eid: str, payload: PrepCheckUnitRequest, user: dict = Depends(get_current_user)):
    _prep_locked_block_unless_almacen({}, user)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("prep_status") == "preparado":
        raise HTTPException(423, "Evento bloqueado. Desbloquea primero.")
    checks = list(ev.get("prep_checks") or [])
    if payload.checked and payload.unit_id not in checks:
        checks.append(payload.unit_id)
    if not payload.checked and payload.unit_id in checks:
        checks = [c for c in checks if c != payload.unit_id]
    log = list(ev.get("prep_log") or [])
    log.append(_prep_log_entry(
        "check" if payload.checked else "uncheck", user, unit_id=payload.unit_id,
    ))
    await db.events.update_one({"id": eid}, {"$set": {"prep_checks": checks, "prep_log": log}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/prep/substitute")
async def prep_substitute(eid: str, payload: PrepSubstituteRequest, user: dict = Depends(get_current_user)):
    _prep_locked_block_unless_almacen({}, user)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("prep_status") == "preparado":
        raise HTTPException(423, "Evento bloqueado. Desbloquea primero.")
    em = next((m for m in ev.get("materials", []) if m["material_id"] == payload.material_id), None)
    if not em:
        raise HTTPException(404, "Material no bloqueado en el evento")
    old_u = await db.units.find_one({"id": payload.old_unit_id}, PROJ)
    new_u = await db.units.find_one({"id": payload.new_unit_id}, PROJ)
    if not old_u or not new_u:
        raise HTTPException(404, "Unidad no encontrada")
    if old_u["material_id"] != payload.material_id:
        raise HTTPException(400, "La unidad antigua no pertenece al material indicado")
    # Determine target material for the new unit
    target_mid = new_u["material_id"]
    if payload.new_material_id and payload.new_material_id != target_mid:
        raise HTTPException(400, "La nueva unidad no pertenece al material destino")
    # Check the new unit is not already locked elsewhere (overlap), not broken, and not already in this event
    cw = event_window(ev)
    others = await db.events.find({"id": {"$ne": eid}}, PROJ).to_list(5000)
    busy_ids: set = set()
    for oev in others:
        if overlaps(cw, event_window(oev)):
            busy_ids |= event_unit_ids(oev)
    if new_u["status"] != "available":
        raise HTTPException(400, f"Unidad {new_u['reference']} en estado {new_u['status']}")
    if new_u["id"] in busy_ids:
        raise HTTPException(400, f"Unidad {new_u['reference']} solapa con otro evento")
    self_ids = event_unit_ids(ev)
    if new_u["id"] in self_ids:
        raise HTTPException(400, f"Unidad {new_u['reference']} ya está bloqueada en este evento")

    # --- Same-material in-place swap ---
    if target_mid == payload.material_id:
        units = list(em.get("units", []))
        found = False
        for i, u in enumerate(units):
            if u["unit_id"] == payload.old_unit_id:
                units[i] = {
                    **u,
                    "unit_id": new_u["id"],
                    "reference": new_u["reference"],
                    "subitems": new_u.get("subitems", []),
                }
                found = True
                break
        if not found:
            raise HTTPException(404, "Unidad antigua no estaba bloqueada en este material")
        checks = list(ev.get("prep_checks") or [])
        if payload.old_unit_id in checks:
            checks = [c if c != payload.old_unit_id else payload.new_unit_id for c in checks]
        log = list(ev.get("prep_log") or [])
        log.append(_prep_log_entry(
            "substitute", user,
            material_id=payload.material_id,
            old_unit_id=payload.old_unit_id, old_reference=old_u["reference"],
            new_unit_id=payload.new_unit_id, new_reference=new_u["reference"],
        ))
        await db.events.update_one(
            {"id": eid, "materials.material_id": payload.material_id},
            {"$set": {"materials.$.units": units, "prep_checks": checks, "prep_log": log}},
        )
        return await db.events.find_one({"id": eid}, PROJ)

    # --- Cross-material substitution ---
    # 1) Remove old unit from its material entry (pull or empty -> remove material)
    new_old_units = [x for x in em.get("units", []) if x["unit_id"] != payload.old_unit_id]
    if not new_old_units:
        await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": payload.material_id}}})
    else:
        await db.events.update_one(
            {"id": eid, "materials.material_id": payload.material_id},
            {"$set": {"materials.$.units": new_old_units}},
        )
    # 2) Add new unit to its material entry (create entry if missing)
    NewM = await db.materials.find_one({"id": target_mid}, PROJ)
    if not NewM:
        raise HTTPException(404, "Material destino no encontrado")
    ev2 = await db.events.find_one({"id": eid}, PROJ)
    existing_new = next((m for m in ev2.get("materials", []) if m["material_id"] == target_mid), None)
    new_snap = {
        "unit_id": new_u["id"],
        "reference": new_u["reference"],
        "subitems": new_u.get("subitems", []),
        "flightcase": "",
    }
    if existing_new:
        await db.events.update_one(
            {"id": eid, "materials.material_id": target_mid},
            {"$push": {"materials.$.units": new_snap}},
        )
    else:
        em_new = EventMaterial(
            material_id=target_mid,
            name=NewM["name"],
            category=NewM["category"],
            reference=NewM.get("reference", ""),
            units=[EventUnitSnapshot(**new_snap)],
        )
        await db.events.update_one({"id": eid}, {"$push": {"materials": em_new.model_dump()}})
    # 3) Update prep_checks: drop old, keep checked state on new
    checks = list(ev.get("prep_checks") or [])
    was_checked = payload.old_unit_id in checks
    checks = [c for c in checks if c != payload.old_unit_id]
    if was_checked and payload.new_unit_id not in checks:
        checks.append(payload.new_unit_id)
    # 4) Log
    log = list(ev.get("prep_log") or [])
    log.append(_prep_log_entry(
        "substitute", user,
        material_id=payload.material_id,
        old_unit_id=payload.old_unit_id, old_reference=old_u["reference"],
        new_material_id=target_mid,
        new_unit_id=payload.new_unit_id, new_reference=new_u["reference"],
    ))
    await db.events.update_one({"id": eid}, {"$set": {"prep_checks": checks, "prep_log": log}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/prep/check-batch")
async def prep_check_batch(eid: str, payload: PrepCheckBatchRequest, user: dict = Depends(get_current_user)):
    _prep_locked_block_unless_almacen({}, user)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("prep_status") == "preparado":
        raise HTTPException(423, "Evento bloqueado. Desbloquea primero.")
    checks = set(ev.get("prep_checks") or [])
    log = list(ev.get("prep_log") or [])
    changed = 0
    for uid in payload.unit_ids:
        if payload.checked and uid not in checks:
            checks.add(uid)
            changed += 1
            log.append(_prep_log_entry("check", user, unit_id=uid))
        elif not payload.checked and uid in checks:
            checks.discard(uid)
            changed += 1
            log.append(_prep_log_entry("uncheck", user, unit_id=uid))
    if changed:
        await db.events.update_one({"id": eid}, {"$set": {"prep_checks": list(checks), "prep_log": log}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/prep/remove-unit")
async def prep_remove_unit(eid: str, payload: PrepRemoveRequest, user: dict = Depends(get_current_user)):
    _prep_locked_block_unless_almacen({}, user)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("prep_status") == "preparado":
        raise HTTPException(423, "Evento bloqueado. Desbloquea primero.")
    em = next((m for m in ev.get("materials", []) if m["material_id"] == payload.material_id), None)
    if not em:
        raise HTTPException(404, "Material no bloqueado")
    u = await db.units.find_one({"id": payload.unit_id}, PROJ)
    new_units = [x for x in em.get("units", []) if x["unit_id"] != payload.unit_id]
    log = list(ev.get("prep_log") or [])
    log.append(_prep_log_entry(
        "remove_unit", user,
        material_id=payload.material_id,
        unit_id=payload.unit_id,
        reference=(u or {}).get("reference", ""),
    ))
    checks = [c for c in (ev.get("prep_checks") or []) if c != payload.unit_id]
    if new_units:
        await db.events.update_one(
            {"id": eid, "materials.material_id": payload.material_id},
            {"$set": {"materials.$.units": new_units, "prep_checks": checks, "prep_log": log}},
        )
    else:
        await db.events.update_one(
            {"id": eid},
            {"$pull": {"materials": {"material_id": payload.material_id}},
             "$set": {"prep_checks": checks, "prep_log": log}},
        )
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/prep/lock")
async def prep_lock(eid: str, user: dict = Depends(require_almacen)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    log = list(ev.get("prep_log") or [])
    log.append(_prep_log_entry("lock", user))
    await db.events.update_one({"id": eid}, {"$set": {
        "prep_status": "preparado",
        "prep_locked_at": datetime.now(timezone.utc).isoformat(),
        "prep_locked_by": user["id"],
        "prep_locked_by_name": user.get("name") or user.get("email", ""),
        "prep_log": log,
    }})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/prep/unlock")
async def prep_unlock(eid: str, user: dict = Depends(require_almacen)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    log = list(ev.get("prep_log") or [])
    log.append(_prep_log_entry("unlock", user))
    await db.events.update_one({"id": eid}, {"$set": {
        "prep_status": "pendiente",
        "prep_locked_at": None, "prep_locked_by": None, "prep_locked_by_name": "",
        "prep_log": log,
    }})
    return await db.events.find_one({"id": eid}, PROJ)


# ---------- Packs ----------
@api_router.get("/packs", response_model=List[Pack])
async def list_packs():
    return await db.packs.find({}, PROJ).sort("name", 1).to_list(500)


@api_router.post("/packs", response_model=Pack)
async def create_pack(payload: PackCreate, _u: dict = Depends(require_warehouse)):
    p = Pack(**payload.model_dump())
    await db.packs.insert_one(p.model_dump())
    return p


@api_router.put("/packs/{pid}", response_model=Pack)
async def update_pack(pid: str, payload: PackCreate, _u: dict = Depends(require_warehouse)):
    res = await db.packs.find_one_and_update({"id": pid}, {"$set": payload.model_dump()}, return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Pack not found")
    return res


@api_router.delete("/packs/{pid}")
async def delete_pack(pid: str, _u: dict = Depends(require_warehouse)):
    await db.packs.delete_one({"id": pid})
    return {"ok": True}


async def _block_by_quantity(eid: str, material_id: str, quantity: int):
    avail = await _compute_availability(eid, material_id)
    avail_units = [u for u in avail["units"] if u["available"]]
    if len(avail_units) < quantity:
        raise HTTPException(400, f"Solo {len(avail_units)} unidades disponibles, pides {quantity}")
    chosen = [u["id"] for u in avail_units[:quantity]]
    return await _block_units(eid, material_id, chosen)


@api_router.post("/events/{eid}/apply-pack/{pid}")
async def apply_pack(eid: str, pid: str, _u: dict = Depends(require_warehouse)):
    pack = await db.packs.find_one({"id": pid}, PROJ)
    if not pack:
        raise HTTPException(404, "Pack not found")
    results = []
    for it in pack.get("items", []):
        try:
            await _block_by_quantity(eid, it["material_id"], it["quantity"])
            results.append({"material_id": it["material_id"], "ok": True})
        except HTTPException as e:
            results.append({"material_id": it["material_id"], "ok": False, "error": e.detail})
    ev = await db.events.find_one({"id": eid}, PROJ)
    return {"event": ev, "results": results}


# ---------- Incidents ----------
@api_router.post("/incidents")
async def create_incident(payload: IncidentCreate, user: dict = Depends(get_current_user)):
    if not payload.unit_id and not payload.vehicle_id:
        raise HTTPException(400, "unit_id o vehicle_id requerido")
    if payload.unit_id and payload.vehicle_id:
        raise HTTPException(400, "Solo unit_id o vehicle_id, no ambos")
    if payload.unit_id:
        u = await db.units.find_one({"id": payload.unit_id}, PROJ)
        if not u:
            raise HTTPException(404, "Unit not found")
        async for ev in db.events.find({}, PROJ):
            for em in ev.get("materials", []):
                for unit in em.get("units", []):
                    if unit["unit_id"] == payload.unit_id:
                        raise HTTPException(400, "Unidad bloqueada en evento. Libera primero.")
        await db.units.update_one(
            {"id": payload.unit_id},
            {"$set": {
                "status": payload.status,
                "incident_opened_at": datetime.now(timezone.utc).isoformat(),
                "urgent": False,
            }},
        )
        log = IncidentLog(unit_id=payload.unit_id, type="report", status=payload.status,
                          description=payload.description, files=payload.files)
    else:
        v = await db.vehicles.find_one({"id": payload.vehicle_id}, PROJ)
        if not v:
            raise HTTPException(404, "Vehicle not found")
        # ensure not used in any future open event
        async for ev in db.events.find({"status": "abierto"}, PROJ):
            for ovh in ev.get("vehicles", []):
                if ovh.get("type") == "owned" and ovh.get("vehicle_id") == payload.vehicle_id:
                    raise HTTPException(400, f"Vehículo asignado al evento '{ev.get('name','')}'. Quítalo primero.")
        await db.vehicles.update_one(
            {"id": payload.vehicle_id},
            {"$set": {
                "status": payload.status,
                "incident_opened_at": datetime.now(timezone.utc).isoformat(),
                "urgent": False,
            }},
        )
        log = IncidentLog(vehicle_id=payload.vehicle_id, type="report", status=payload.status,
                          description=payload.description, files=payload.files)
    await db.incident_logs.insert_one(log.model_dump())
    return log


@api_router.get("/incidents")
async def list_incidents(user: dict = Depends(get_current_user)):
    """Returns units + vehicles currently in broken/repair status, with their latest log.
    Sorted: urgentes primero, luego por antigüedad de apertura (más antiguos arriba)."""
    out = []
    units = await db.units.find({"status": {"$in": ["broken", "repair"]}}, PROJ).to_list(2000)
    for u in units:
        m = await db.materials.find_one({"id": u["material_id"]}, PROJ)
        latest = await db.incident_logs.find({"unit_id": u["id"]}, PROJ).sort("created_at", -1).to_list(1)
        # backfill: if legacy unit has no incident_opened_at, use latest report log time
        if not u.get("incident_opened_at"):
            rep = await db.incident_logs.find({"unit_id": u["id"], "type": "report"}, PROJ).sort("created_at", -1).to_list(1)
            opened_at = rep[0]["created_at"] if rep else (latest[0]["created_at"] if latest else None)
            if opened_at:
                u["incident_opened_at"] = opened_at
                await db.units.update_one({"id": u["id"]}, {"$set": {"incident_opened_at": opened_at}})
        out.append({
            "kind": "unit",
            "unit": u,
            "material": {"id": m["id"], "name": m["name"], "category": m["category"], "reference": m["reference"]} if m else None,
            "latest": latest[0] if latest else None,
            "urgent": bool(u.get("urgent", False)),
            "opened_at": u.get("incident_opened_at"),
        })
    vehicles = await db.vehicles.find({"status": {"$in": ["broken", "repair"]}}, PROJ).to_list(500)
    for v in vehicles:
        latest = await db.incident_logs.find({"vehicle_id": v["id"]}, PROJ).sort("created_at", -1).to_list(1)
        if not v.get("incident_opened_at"):
            rep = await db.incident_logs.find({"vehicle_id": v["id"], "type": "report"}, PROJ).sort("created_at", -1).to_list(1)
            opened_at = rep[0]["created_at"] if rep else (latest[0]["created_at"] if latest else None)
            if opened_at:
                v["incident_opened_at"] = opened_at
                await db.vehicles.update_one({"id": v["id"]}, {"$set": {"incident_opened_at": opened_at}})
        out.append({
            "kind": "vehicle",
            "vehicle": v,
            "latest": latest[0] if latest else None,
            "urgent": bool(v.get("urgent", False)),
            "opened_at": v.get("incident_opened_at"),
        })
    # urgentes primero, luego más antiguos primero
    out.sort(key=lambda x: (0 if x["urgent"] else 1, x.get("opened_at") or ""))
    return out


@api_router.get("/incident-logs")
async def list_incident_logs(unit_id: Optional[str] = None, material_id: Optional[str] = None,
                             vehicle_id: Optional[str] = None, type: Optional[str] = None,
                             user: dict = Depends(get_current_user)):
    """Flat list of all incident logs with material/vehicle info, optionally filtered."""
    q = {}
    if type:
        q["type"] = type
    if vehicle_id:
        q["vehicle_id"] = vehicle_id
    elif unit_id:
        q["unit_id"] = unit_id
    elif material_id:
        unit_ids = [u["id"] for u in await db.units.find({"material_id": material_id}, PROJ).to_list(5000)]
        q["unit_id"] = {"$in": unit_ids}
    logs = await db.incident_logs.find(q, PROJ).sort("created_at", -1).to_list(2000)
    cache_units: Dict[str, dict] = {}
    cache_mats: Dict[str, dict] = {}
    cache_vehs: Dict[str, dict] = {}
    for log in logs:
        if log.get("vehicle_id"):
            vid = log["vehicle_id"]
            v = cache_vehs.get(vid)
            if v is None:
                v = await db.vehicles.find_one({"id": vid}, PROJ)
                cache_vehs[vid] = v or {}
            log["vehicle"] = {"id": v.get("id"), "name": v.get("name"), "plate": v.get("plate")} if v else None
            log["unit"] = None
            log["material"] = None
        else:
            uid = log.get("unit_id")
            u = cache_units.get(uid)
            if u is None:
                u = await db.units.find_one({"id": uid}, PROJ)
                cache_units[uid] = u or {}
            log["unit"] = {"id": u.get("id"), "reference": u.get("reference"), "status": u.get("status")} if u else None
            mid = u.get("material_id") if u else None
            if mid:
                m = cache_mats.get(mid)
                if m is None:
                    m = await db.materials.find_one({"id": mid}, PROJ)
                    cache_mats[mid] = m or {}
                log["material"] = {"id": m.get("id"), "name": m.get("name"), "category": m.get("category"), "reference": m.get("reference")} if m else None
            else:
                log["material"] = None
            log["vehicle"] = None
    return logs


@api_router.get("/units/{unit_id}/history")
async def unit_history(unit_id: str):
    logs = await db.incident_logs.find({"unit_id": unit_id}, PROJ).sort("created_at", -1).to_list(500)
    return logs


@api_router.get("/vehicles/{vid}/history")
async def vehicle_history(vid: str, user: dict = Depends(get_current_user)):
    logs = await db.incident_logs.find({"vehicle_id": vid}, PROJ).sort("created_at", -1).to_list(500)
    return logs


@api_router.post("/incidents/{unit_id}/resolve")
async def resolve_incident(unit_id: str, payload: IncidentResolve, _u: dict = Depends(require_taller)):
    u = await db.units.find_one({"id": unit_id}, PROJ)
    if not u:
        raise HTTPException(404, "Unit not found")
    await db.units.update_one(
        {"id": unit_id},
        {"$set": {"status": "available"},
         "$unset": {"incident_opened_at": "", "urgent": ""}},
    )
    log = IncidentLog(
        unit_id=unit_id, type="resolve", status="available",
        description=payload.description, files=payload.files,
    )
    await db.incident_logs.insert_one(log.model_dump())
    return log


@api_router.post("/vehicle-incidents/{vid}/resolve")
async def resolve_vehicle_incident(vid: str, payload: IncidentResolve, _u: dict = Depends(require_taller)):
    v = await db.vehicles.find_one({"id": vid}, PROJ)
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await db.vehicles.update_one(
        {"id": vid},
        {"$set": {"status": "available"},
         "$unset": {"incident_opened_at": "", "urgent": ""}},
    )
    log = IncidentLog(
        vehicle_id=vid, type="resolve", status="available",
        description=payload.description, files=payload.files,
    )
    await db.incident_logs.insert_one(log.model_dump())
    return log


@api_router.post("/incidents/{unit_id}/urgent")
async def set_unit_urgent(unit_id: str, payload: dict, _u: dict = Depends(require_productor)):
    u = await db.units.find_one({"id": unit_id}, PROJ)
    if not u:
        raise HTTPException(404, "Unit not found")
    if u.get("status") not in ("broken", "repair"):
        raise HTTPException(400, "La unidad no tiene incidencia activa")
    urgent = bool(payload.get("urgent", True))
    await db.units.update_one({"id": unit_id}, {"$set": {"urgent": urgent}})
    return {"ok": True, "urgent": urgent}


@api_router.post("/vehicle-incidents/{vid}/urgent")
async def set_vehicle_urgent(vid: str, payload: dict, _u: dict = Depends(require_productor)):
    v = await db.vehicles.find_one({"id": vid}, PROJ)
    if not v:
        raise HTTPException(404, "Vehicle not found")
    if v.get("status") not in ("broken", "repair"):
        raise HTTPException(400, "El vehículo no tiene incidencia activa")
    urgent = bool(payload.get("urgent", True))
    await db.vehicles.update_one({"id": vid}, {"$set": {"urgent": urgent}})
    return {"ok": True, "urgent": urgent}


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
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
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


@api_router.get("/file-by-id/{fid}")
async def download_file_by_id(fid: str, _user: dict = Depends(get_current_user)):
    rec = await db.files.find_one({"id": fid, "is_deleted": False})
    if not rec:
        raise HTTPException(404, "File not found")
    data, ct = get_object(rec["storage_path"])
    return Response(content=data, media_type=rec.get("content_type", ct),
                    headers={"Content-Disposition": f'inline; filename="{rec.get("name","file")}"'})


# ---------- Rental: Delivery & Return ----------
from rental_pdf import build_delivery_pdf, build_return_pdf  # noqa: E402
import tempfile as _tempfile  # noqa: E402


class DeliveryFile(BaseModel):
    file_id: str
    name: str = ""
    content_type: str = ""


class DeliveryRequest(BaseModel):
    has_deposit: bool = False
    deposit_amount: float = 0.0
    payment_method: Literal["efectivo", "tarjeta", "transferencia"]
    legal_accepted: bool
    client_email: Optional[str] = None
    signature_file_id: str
    dni_front_file_id: Optional[str] = None
    dni_back_file_id: Optional[str] = None


class ReturnItemStatus(BaseModel):
    id: str  # unit_id or rental_id
    kind: Literal["unit", "rental"] = "unit"
    material_id: Optional[str] = None
    status: Literal["returned", "missing"]
    note: str = ""


class ReturnRequest(BaseModel):
    signature_file_id: str
    items: List[ReturnItemStatus]


class CheckItemStatus(BaseModel):
    id: str
    kind: Literal["unit", "rental"] = "unit"
    material_id: Optional[str] = None
    status: Literal["ok", "nok"]
    note: str = ""
    files: List[ExpenseFile] = []


class CheckRequest(BaseModel):
    items: List[CheckItemStatus]


def _almacen_or_productor(user: dict):
    if user.get("role") not in ("almacen", "productor"):
        raise HTTPException(403, "Solo Almacén o Productor")


async def _file_to_temp(file_id: str) -> Optional[str]:
    """Download a stored file to a temp path and return the path (caller deletes)."""
    if not file_id:
        return None
    rec = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not rec:
        return None
    try:
        data, _ct = get_object(rec["storage_path"])
        ext = rec.get("name", "f").split(".")[-1] if "." in rec.get("name", "") else "png"
        tmp = _tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
        tmp.write(data)
        tmp.close()
        return tmp.name
    except Exception:
        return None


async def _store_pdf(event_id: str, pdf_bytes: bytes, name: str) -> dict:
    fid = str(uuid.uuid4())
    path = f"{APP_NAME}/uploads/{fid}.pdf"
    put_object(path, pdf_bytes, "application/pdf")
    rec = {
        "id": fid, "storage_path": path, "name": name,
        "content_type": "application/pdf", "size": len(pdf_bytes),
        "created_at": datetime.now(timezone.utc).isoformat(), "is_deleted": False,
    }
    await db.files.insert_one(rec)
    return {"file_id": fid, "name": name, "content_type": "application/pdf"}


@api_router.post("/events/{eid}/delivery")
async def submit_delivery(eid: str, payload: DeliveryRequest, user: dict = Depends(get_current_user)):
    _almacen_or_productor(user)
    if not payload.legal_accepted:
        raise HTTPException(400, "Debes aceptar el aviso legal")
    if payload.has_deposit and payload.deposit_amount < 0:
        raise HTTPException(400, "Importe de fianza inválido")
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("type") != "alquiler":
        raise HTTPException(400, "Entrega solo disponible para alquileres simples")
    if (ev.get("delivery") or {}).get("delivered_at"):
        raise HTTPException(400, "Este alquiler ya tiene una entrega registrada")
    delivered_at = datetime.now(timezone.utc).isoformat()
    delivery_doc: dict = {
        "delivered_at": delivered_at,
        "has_deposit": payload.has_deposit,
        "deposit_amount": float(payload.deposit_amount) if payload.has_deposit else 0.0,
        "payment_method": payload.payment_method,
        "client_email": (payload.client_email or "").strip() or None,
        "legal_accepted": True,
        "signature_file_id": payload.signature_file_id,
        "dni_front_file_id": payload.dni_front_file_id,
        "dni_back_file_id": payload.dni_back_file_id,
        "by_user_id": user["id"],
        "by_user_name": user.get("name") or user.get("email", ""),
    }
    # Generate PDF
    sig_path = await _file_to_temp(payload.signature_file_id)
    try:
        pdf_bytes = build_delivery_pdf({**ev, "delivery": delivery_doc}, delivery_doc, sig_path)
    finally:
        if sig_path:
            try:
                os.unlink(sig_path)
            except Exception:
                pass
    stored = await _store_pdf(eid, pdf_bytes, f"entrega_{(ev.get('reference') or ev.get('name','evento')).replace(' ', '_')}.pdf")
    delivery_doc["doc_file_id"] = stored["file_id"]
    delivery_doc["doc_name"] = stored["name"]
    await db.events.update_one({"id": eid}, {"$set": {"delivery": delivery_doc}})

    # Optional email to client (sandbox mode: only verified address receives)
    if delivery_doc["client_email"]:
        try:
            html = render_basic(
                title="Recibo de entrega · Edison Rent",
                body_html=(
                    f"Hola {ev.get('client_name','cliente')},<br><br>"
                    "Adjuntamos el recibo de entrega del material alquilado. "
                    "Guárdalo para la devolución.<br><br>"
                    "Gracias por confiar en Edison Rent."
                ),
                footer="EDISON RENT SL · B60800301",
            )
            await send_email(
                delivery_doc["client_email"],
                f"Entrega de material – {ev.get('name','Alquiler')}",
                html,
                attachments=[{"filename": stored["name"], "content": pdf_bytes}],
            )
        except Exception as e:
            logger.error("delivery email error: %s", e)

    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/return")
async def submit_return(eid: str, payload: ReturnRequest, user: dict = Depends(get_current_user)):
    _almacen_or_productor(user)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("type") != "alquiler":
        raise HTTPException(400, "Devolución solo disponible para alquileres simples")
    delivery = ev.get("delivery") or {}
    if not delivery.get("delivered_at"):
        raise HTTPException(400, "Primero hay que registrar la entrega")
    if (ev.get("return_info") or {}).get("returned_at"):
        raise HTTPException(400, "Devolución ya registrada")

    returned_at = datetime.now(timezone.utc).isoformat()
    return_doc: dict = {
        "returned_at": returned_at,
        "signature_file_id": payload.signature_file_id,
        "items": [it.model_dump() for it in payload.items],
        "by_user_id": user["id"],
        "by_user_name": user.get("name") or user.get("email", ""),
    }

    # Missing items at this stage are considered lost → mark broken + incident
    incident_count = 0
    for it in payload.items:
        if it.kind == "unit" and it.status == "missing":
            await db.units.update_one({"id": it.id}, {"$set": {"status": "broken"}})
            desc = (
                f"Devolución alquiler '{ev.get('name','')}': faltante"
                + (f". Nota: {it.note}" if it.note else "")
            )
            log = IncidentLog(
                unit_id=it.id, type="report", status="broken",
                description=desc, files=[],
            )
            await db.incident_logs.insert_one(log.model_dump())
            incident_count += 1
    return_doc["incidents_opened"] = incident_count

    # Generate "received pending check" PDF
    delivery_sig_path = await _file_to_temp(delivery.get("signature_file_id"))
    return_sig_path = await _file_to_temp(payload.signature_file_id)
    try:
        pdf_bytes = build_return_pdf(ev, delivery, return_doc, delivery_sig_path, return_sig_path)
    finally:
        for p in (delivery_sig_path, return_sig_path):
            if p:
                try:
                    os.unlink(p)
                except Exception:
                    pass
    stored = await _store_pdf(eid, pdf_bytes, f"devolucion_{(ev.get('reference') or ev.get('name','evento')).replace(' ', '_')}.pdf")
    return_doc["doc_file_id"] = stored["file_id"]
    return_doc["doc_name"] = stored["name"]
    await db.events.update_one({"id": eid}, {"$set": {"return_info": return_doc}})

    # Email PDF to client
    if delivery.get("client_email"):
        try:
            html = render_basic(
                title="Acta de recepción · Edison Rent",
                body_html=(
                    f"Hola {ev.get('client_name','cliente')},<br><br>"
                    "Adjuntamos el acta de recepción del material. "
                    "Edison Rent SL declara haber recibido el siguiente material, "
                    "a la espera de la comprobación de su estado.<br><br>"
                    "Gracias por confiar en Edison Rent."
                ),
                footer="EDISON RENT SL · B60800301",
            )
            await send_email(
                delivery["client_email"],
                f"Recepción de material – {ev.get('name','Alquiler')}",
                html,
                attachments=[{"filename": stored["name"], "content": pdf_bytes}],
            )
        except Exception as e:
            logger.error("return email error: %s", e)

    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/check")
async def submit_check(eid: str, payload: CheckRequest, user: dict = Depends(get_current_user)):
    _almacen_or_productor(user)
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("type") != "alquiler":
        raise HTTPException(400, "Comprobación solo disponible para alquileres simples")
    if not (ev.get("return_info") or {}).get("returned_at"):
        raise HTTPException(400, "Primero hay que registrar la devolución")
    if (ev.get("check_info") or {}).get("checked_at"):
        raise HTTPException(400, "Comprobación ya registrada")

    # Whitelist of returned item ids (cannot check items declared missing on return)
    returned_ids = {it["id"] for it in (ev.get("return_info") or {}).get("items", []) if it.get("status") == "returned"}
    incident_count = 0
    for it in payload.items:
        if it.id not in returned_ids:
            continue
        if it.kind == "unit" and it.status == "nok":
            await db.units.update_one({"id": it.id}, {"$set": {"status": "broken"}})
            desc = (
                f"Comprobación alquiler '{ev.get('name','')}': dañado"
                + (f". Nota: {it.note}" if it.note else "")
            )
            log = IncidentLog(
                unit_id=it.id, type="report", status="broken",
                description=desc,
                files=[{"file_id": f.file_id, "name": f.name, "content_type": f.content_type} for f in (it.files or [])],
            )
            await db.incident_logs.insert_one(log.model_dump())
            incident_count += 1

    checked_at = datetime.now(timezone.utc).isoformat()
    check_doc: dict = {
        "checked_at": checked_at,
        "items": [it.model_dump() for it in payload.items],
        "incidents_opened": incident_count,
        "by_user_id": user["id"],
        "by_user_name": user.get("name") or user.get("email", ""),
    }

    # Build combined statuses for final PDF (ok / nok / missing)
    combined: Dict[str, str] = {}
    notes: Dict[str, str] = {}
    for it in (ev.get("return_info") or {}).get("items", []):
        if it.get("status") == "missing":
            combined[it["id"]] = "missing"
            if it.get("note"):
                notes[it["id"]] = it["note"]
    for it in payload.items:
        combined[it.id] = it.status  # ok or nok
        if it.note:
            notes[it.id] = it.note

    # Generate internal check PDF
    delivery_sig_path = await _file_to_temp((ev.get("delivery") or {}).get("signature_file_id"))
    return_sig_path = await _file_to_temp((ev.get("return_info") or {}).get("signature_file_id"))
    try:
        check_pdf_doc = {
            "returned_at": (ev.get("return_info") or {}).get("returned_at"),
            "items": [{"id": k, "status": v, "note": notes.get(k, "")} for k, v in combined.items()],
            "incidents_opened": incident_count,
        }
        pdf_bytes = build_return_pdf(ev, ev.get("delivery") or {}, check_pdf_doc,
                                     delivery_sig_path, return_sig_path,
                                     title="ACTA DE COMPROBACIÓN · ALQUILER")
    finally:
        for p in (delivery_sig_path, return_sig_path):
            if p:
                try:
                    os.unlink(p)
                except Exception:
                    pass
    stored = await _store_pdf(eid, pdf_bytes, f"comprobacion_{(ev.get('reference') or ev.get('name','evento')).replace(' ', '_')}.pdf")
    check_doc["doc_file_id"] = stored["file_id"]
    check_doc["doc_name"] = stored["name"]
    await db.events.update_one({"id": eid}, {"$set": {"check_info": check_doc}})
    return await db.events.find_one({"id": eid}, PROJ)




# ---------- Technician assignment with notes + responsible ----------
@api_router.post("/events/{eid}/technicians")
async def assign_technicians(eid: str, payload: TechAssignmentRequest, user: dict = Depends(require_productor)):
    """Assign techs + optionally set per-tech private notes and a responsible technician."""
    prev = await db.events.find_one({"id": eid}, PROJ)
    if not prev:
        raise HTTPException(404, "Event not found")
    tech_ids = list(dict.fromkeys(payload.assigned_technicians or []))
    valid_users = await db.users.find({"id": {"$in": tech_ids}, "active": True}, PROJ).to_list(500)
    valid_ids = {u["id"] for u in valid_users}
    tech_ids = [t for t in tech_ids if t in valid_ids]
    update: Dict[str, Any] = {"assigned_technicians": tech_ids}
    resp = payload.responsible_technician_id
    if resp and resp not in tech_ids:
        raise HTTPException(400, "El responsable debe estar entre los técnicos asignados")
    update["responsible_technician_id"] = resp
    if payload.tech_notes is not None:
        update["tech_notes"] = {tid: note for tid, note in payload.tech_notes.items() if tid in tech_ids}
    else:
        existing_notes = prev.get("tech_notes") or {}
        update["tech_notes"] = {tid: n for tid, n in existing_notes.items() if tid in tech_ids}
    await db.events.update_one({"id": eid}, {"$set": update})
    res = await db.events.find_one({"id": eid}, PROJ)
    try:
        prev_set = set(prev.get("assigned_technicians") or [])
        new_set = set(res.get("assigned_technicians") or [])
        added = new_set - prev_set
        for tid in added:
            tech = next((u for u in valid_users if u["id"] == tid), None)
            if not tech:
                continue
            public_url = os.environ.get("APP_PUBLIC_URL", "")
            ev_url = f"{public_url}/eventos/{eid}"
            date_str = res.get("event_date") or res.get("setup_date") or ""
            tech_note = (res.get("tech_notes") or {}).get(tid) or ""
            note_html = ""
            if tech_note:
                safe_note = tech_note.replace("\n", "<br>")
                note_html = (
                    "<br><br><div style='border-left:3px solid #b45309;padding:8px 12px;"
                    "background:#fffbeb;color:#78350f;'>"
                    f"<b>Nota privada del productor:</b><br>{safe_note}</div>"
                )
            is_resp = res.get("responsible_technician_id") == tid
            resp_html = "<br><br><b>Has sido marcado como responsable del evento.</b>" if is_resp else ""
            body = (f"Hola {tech.get('name') or tech['email']}, has sido asignado al evento "
                    f"<b>{res.get('name','')}</b>.<br><br>"
                    f"<b>Fecha:</b> {date_str}<br>"
                    f"<b>Ubicación:</b> {res.get('location') or '—'}<br>"
                    f"<b>Cliente:</b> {res.get('client_name') or '—'}<br>"
                    f"<b>Horarios:</b> {res.get('schedule') or '—'}"
                    f"{resp_html}{note_html}")
            html = render_basic(title="Te han asignado a un evento", body_html=body,
                                cta_label="Ver detalles", cta_url=ev_url, footer="Edison Rent")
            await send_email(tech["email"], f"Asignación: {res.get('name','evento')}", html)
    except Exception as e:
        logger.error("technician notify error: %s", e)
    return res


# ---------- Expenses (bolos only) ----------
def _can_view_expenses(ev: dict, user: dict) -> bool:
    if user.get("role") == "productor":
        return True
    if user.get("role") == "tecnico" and ev.get("responsible_technician_id") == user["id"]:
        return True
    return False


@api_router.get("/events/{eid}/expenses")
async def list_expenses(eid: str, user: dict = Depends(get_current_user)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("type") != "bolo":
        raise HTTPException(400, "Gastos solo disponibles en bolos")
    if not _can_view_expenses(ev, user):
        raise HTTPException(403, "Sin permiso para ver gastos de este evento")
    return ev.get("expenses", [])


@api_router.post("/events/{eid}/expenses")
async def add_expense(eid: str, payload: ExpenseCreate, user: dict = Depends(get_current_user)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("type") != "bolo":
        raise HTTPException(400, "Gastos solo disponibles en bolos")
    if not _can_view_expenses(ev, user):
        raise HTTPException(403, "Sin permiso para añadir gastos a este evento")
    if payload.amount < 0:
        raise HTTPException(400, "Importe inválido")
    if not payload.description.strip():
        raise HTTPException(400, "Descripción obligatoria")
    exp = Expense(
        description=payload.description.strip(),
        amount=float(payload.amount),
        currency=payload.currency or "EUR",
        files=list(payload.files or []),
        created_by=user["id"],
        created_by_name=user.get("name") or user.get("email", ""),
    )
    await db.events.update_one({"id": eid}, {"$push": {"expenses": exp.model_dump()}})
    return exp


@api_router.delete("/events/{eid}/expenses/{xid}")
async def delete_expense(eid: str, xid: str, user: dict = Depends(get_current_user)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("type") != "bolo":
        raise HTTPException(400, "Gastos solo disponibles en bolos")
    if not _can_view_expenses(ev, user):
        raise HTTPException(403, "Sin permiso")
    exp = next((e for e in (ev.get("expenses") or []) if e.get("id") == xid), None)
    if not exp:
        raise HTTPException(404, "Gasto no encontrado")
    if user.get("role") != "productor" and exp.get("created_by") != user["id"]:
        raise HTTPException(403, "Solo el productor o el creador puede eliminar el gasto")
    await db.events.update_one({"id": eid}, {"$pull": {"expenses": {"id": xid}}})
    return {"ok": True}


# ---------- Tasks (independent technician calendar items) ----------
@api_router.get("/tasks")
async def list_tasks(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    technician_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q: Dict[str, Any] = {}
    if technician_id:
        q["assigned_technicians"] = technician_id
    if from_ or to:
        rng: Dict[str, Any] = {}
        if from_:
            rng["$gte"] = from_
        if to:
            rng["$lte"] = to
        q["start_dt"] = rng
    items = await db.tasks.find(q, PROJ).sort("start_dt", 1).to_list(2000)
    if user.get("role") == "tecnico":
        items = [t for t in items if user["id"] in (t.get("assigned_technicians") or [])]
    return items


@api_router.post("/tasks", response_model=Task)
async def create_task(payload: TaskCreate, user: dict = Depends(require_productor)):
    if not payload.title.strip():
        raise HTTPException(400, "Título obligatorio")
    if not payload.start_dt:
        raise HTTPException(400, "Fecha/hora de inicio obligatoria")
    t = Task(
        title=payload.title.strip(),
        kind=payload.kind,
        start_dt=payload.start_dt,
        end_dt=payload.end_dt,
        location=payload.location.strip(),
        notes=payload.notes,
        assigned_technicians=list(dict.fromkeys(payload.assigned_technicians or [])),
        related_event_id=payload.related_event_id,
        files=list(payload.files or []),
        created_by=user["id"],
        created_by_name=user.get("name") or user.get("email", ""),
    )
    await db.tasks.insert_one(t.model_dump())
    return t


@api_router.put("/tasks/{tid}", response_model=Task)
async def update_task(tid: str, payload: TaskUpdate, _u: dict = Depends(require_productor)):
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(400, "Nada que actualizar")
    res = await db.tasks.find_one_and_update({"id": tid}, {"$set": upd},
                                             return_document=True, projection=PROJ)
    if not res:
        raise HTTPException(404, "Tarea no encontrada")
    return res


@api_router.delete("/tasks/{tid}")
async def delete_task(tid: str, _u: dict = Depends(require_productor)):
    r = await db.tasks.delete_one({"id": tid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Tarea no encontrada")
    return {"ok": True}




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
                if cat_has_unit_refs:
                    for m in sorted(by_cat[cat], key=lambda x: x.get("reference") or x["name"]):
                        units = m.get("units", [])
                        head = f"<b>{m.get('reference','') + ' · ' if m.get('reference') else ''}{m['name']}</b> &nbsp;<font color='#78716c'>x{len(units)}</font>"
                        story.append(Paragraph(head, ParagraphStyle("ml", parent=body, fontSize=10, spaceBefore=3, spaceAfter=1)))
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
                    # No-unit-ref categories (cables): group by flightcase first, then by material
                    fc_groups: Dict[str, Dict[str, dict]] = {}
                    for m in by_cat[cat]:
                        for u in m.get("units", []):
                            fc = u.get("flightcase") or ""
                            mat_key = m.get("reference") or m["name"]
                            fc_groups.setdefault(fc, {}).setdefault(mat_key, {"name": m["name"], "reference": m.get("reference",""), "qty": 0})
                            fc_groups[fc][mat_key]["qty"] += 1
                    fc_keys = sorted(fc_groups.keys(), key=lambda x: (x == "", x))
                    for fc_name in fc_keys:
                        label = fc_name if fc_name else "Sin flightcase"
                        story.append(Paragraph(
                            f"<b>{label}</b>",
                            ParagraphStyle("fch", parent=body, fontSize=10, spaceBefore=4, spaceAfter=2,
                                           textColor=colors.HexColor("#3730a3"), fontName="Helvetica-Bold",
                                           leftIndent=6),
                        ))
                        for mat_key in sorted(fc_groups[fc_name].keys()):
                            mm = fc_groups[fc_name][mat_key]
                            ref_label = (mm["reference"] + " · ") if mm["reference"] else ""
                            story.append(Paragraph(
                                f"&nbsp;&nbsp;• {ref_label}{mm['name']} <font color='#78716c'>x{mm['qty']}</font>",
                                ParagraphStyle("fci", parent=body, fontSize=10, leftIndent=16),
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

    vehicles = event.get("vehicles", [])
    if vehicles:
        story.append(Paragraph("Vehículos", h2))
        rows = [["Tipo", "Matrícula", "Nombre", "Notas"]]
        for v in vehicles:
            tipo = "Propio" if v.get("type") == "owned" else "Alquiler"
            rows.append([tipo, v.get("plate") or "—", v.get("name") or "—", v.get("notes") or ""])
        t = Table(rows, colWidths=[2.5 * cm, 3 * cm, 6 * cm, 4.5 * cm])
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e0e7ff")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
        ]))
        story.append(t)

    if not materials and not rentals and not vehicles:
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


def _build_prep_pdf(event: dict, cat_meta: dict) -> bytes:
    """PDF de hoja de preparación con casillas vacías para tachar a mano."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm,
        topMargin=1.2 * cm, bottomMargin=1.6 * cm,
        title=f"Preparación {event.get('name','')}",
    )
    styles = getSampleStyleSheet()
    body = styles["Normal"]
    h_cat = ParagraphStyle("hcat", parent=body, fontSize=12, textColor=colors.HexColor("#111827"),
                           spaceBefore=10, spaceAfter=4, fontName="Helvetica-Bold")
    h_mat = ParagraphStyle("hmat", parent=body, fontSize=10, fontName="Helvetica-Bold", spaceBefore=4, spaceAfter=2)
    h_fc = ParagraphStyle("hfc", parent=body, fontSize=10, fontName="Helvetica-Bold",
                          textColor=colors.HexColor("#3730a3"), spaceBefore=6, spaceAfter=2, leftIndent=4)
    unit_style = ParagraphStyle("unit", parent=body, fontSize=10, leftIndent=10)
    story = []

    if LOGO_PATH.exists():
        try:
            ir = ImageReader(str(LOGO_PATH))
            iw, ih = ir.getSize()
            target_w = 3.5 * cm
            target_h = target_w * (ih / iw)
            if target_h > 1.6 * cm:
                target_h = 1.6 * cm
                target_w = target_h * (iw / ih)
            logo = Image(str(LOGO_PATH), width=target_w, height=target_h)
            logo.hAlign = "LEFT"
            type_label = "BOLO" if event.get("type") == "bolo" else "ALQUILER"
            extras = ""
            if event.get('client_name'):
                extras += f" · {event.get('client_name')}"
            if event.get('reference'):
                extras += f" · Ref. {event.get('reference')}"
            head_right = Paragraph(
                f"<b>HOJA DE PREPARACIÓN</b><br/><font size=14>{event.get('name','Evento')}</font><br/>"
                f"<font size=9 color='#78716c'>{type_label}{extras}</font>",
                ParagraphStyle("hr", parent=body, fontSize=10, alignment=2),
            )
            head_tbl = Table([[logo, head_right]], colWidths=[4 * cm, 13.5 * cm])
            head_tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#1c1917")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.append(head_tbl)
            story.append(Spacer(1, 8))
        except Exception:
            pass

    meta_rows = []
    if event.get("location"):
        meta_rows.append(["Ubicación", event["location"]])
    if event.get("type") == "bolo":
        if event.get("warehouse_out_dt"):
            meta_rows.append(["Salida nave", _fmt_dt(event.get("warehouse_out_dt"))])
        if event.get("return_dt"):
            meta_rows.append(["Devolución", _fmt_dt(event.get("return_dt"))])
    else:
        if event.get("setup_date"):
            meta_rows.append(["Fecha montaje", _fmt_dt(event.get("setup_date"))])
        if event.get("event_date"):
            meta_rows.append(["Fecha acto", _fmt_dt(event.get("event_date"))])
    if meta_rows:
        mt = Table(meta_rows, colWidths=[3.5 * cm, 14 * cm])
        mt.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
            ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#78716c")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
        ]))
        story.append(mt)
        story.append(Spacer(1, 10))

    story.append(Paragraph(
        "<b>MATERIAL A PREPARAR</b>",
        ParagraphStyle("ttl", parent=body, fontSize=11, textColor=colors.HexColor("#b45309"),
                       fontName="Helvetica-Bold", spaceAfter=2),
    ))
    story.append(Spacer(1, 4))

    CHECK_W = 0.55 * cm

    def _row(label_para):
        row = Table([["", label_para]], colWidths=[CHECK_W, 17.2 * cm - CHECK_W])
        row.setStyle(TableStyle([
            ("BOX", (0, 0), (0, 0), 0.6, colors.HexColor("#1c1917")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (1, 0), (1, 0), 6),
            ("LEFTPADDING", (0, 0), (0, 0), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        return row

    materials = event.get("materials", [])
    by_cat: Dict[str, List[dict]] = {}
    for m in materials:
        by_cat.setdefault(m["category"], []).append(m)

    cat_order = cat_meta.get("__cat_order__") or list(by_cat.keys())
    for cat in cat_order:
        if cat not in by_cat:
            continue
        cat_label = cat_meta.get(f"__cat_label__{cat}", cat.capitalize())
        cat_unit_refs = cat_meta.get(f"__cat_unit_refs__{cat}", True)
        story.append(Paragraph(cat_label.upper(), h_cat))

        if cat_unit_refs:
            for m in sorted(by_cat[cat], key=lambda x: x.get("reference") or x["name"]):
                units = m.get("units", [])
                ref_pfx = f"{m.get('reference','')} · " if m.get("reference") else ""
                story.append(Paragraph(
                    f"{ref_pfx}{m['name']} <font color='#78716c'>×{len(units)}</font>",
                    h_mat,
                ))
                for u in units:
                    label = Paragraph(
                        f"<font face='Courier' size=9 color='#b45309'>{u['reference']}</font>",
                        unit_style,
                    )
                    story.append(_row(label))
        else:
            fc_groups: Dict[str, Dict[str, dict]] = {}
            for m in by_cat[cat]:
                for u in m.get("units", []):
                    fc = u.get("flightcase") or ""
                    mat_key = m.get("reference") or m["name"]
                    fc_groups.setdefault(fc, {}).setdefault(mat_key, {
                        "name": m["name"], "reference": m.get("reference", ""), "qty": 0,
                    })
                    fc_groups[fc][mat_key]["qty"] += 1
            fc_keys = sorted(fc_groups.keys(), key=lambda x: (x == "", x))
            for fc_name in fc_keys:
                fc_label = fc_name if fc_name else "Sin flightcase"
                story.append(Paragraph(fc_label, h_fc))
                for mat_key in sorted(fc_groups[fc_name].keys()):
                    mm = fc_groups[fc_name][mat_key]
                    ref_pfx = f"{mm['reference']} · " if mm["reference"] else ""
                    label = Paragraph(
                        f"{ref_pfx}{mm['name']} <font color='#78716c'>×{mm['qty']}</font>",
                        unit_style,
                    )
                    story.append(_row(label))

    rentals = event.get("rentals", [])
    if rentals:
        story.append(Paragraph("ALQUILER EXTERNO", h_cat))
        for r in rentals:
            extra = f" · {r.get('provider_name')}" if r.get("provider_name") else ""
            label = Paragraph(
                f"{r['name']} <font color='#78716c'>×{r['quantity']}{extra}</font>",
                unit_style,
            )
            story.append(_row(label))

    story.append(Spacer(1, 16))
    sig = Table(
        [["Preparado por", "Fecha y firma"], ["", ""]],
        colWidths=[8 * cm, 8 * cm], rowHeights=[0.6 * cm, 1.8 * cm],
    )
    sig.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#78716c")),
        ("BOX", (0, 1), (0, 1), 0.5, colors.HexColor("#1c1917")),
        ("BOX", (1, 1), (1, 1), 0.5, colors.HexColor("#1c1917")),
    ]))
    story.append(sig)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Generado el {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')} · Edison Rent · Hoja interna",
        ParagraphStyle("foot", parent=body, fontSize=8, textColor=colors.HexColor("#9ca3af")),
    ))

    doc.build(story)
    return buf.getvalue()


@api_router.get("/events/{eid}/export-prep")
async def export_prep_pdf(eid: str, user: dict = Depends(get_current_user)):
    if user.get("role") not in ("productor", "almacen"):
        raise HTTPException(403, "Sin permiso para descargar la hoja de preparación")
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    cats = await db.categories.find({}, PROJ).sort("order", 1).to_list(200)
    cat_meta = {"__cat_order__": [c["key"] for c in cats]}
    for c in cats:
        cat_meta[f"__cat_label__{c['key']}"] = c["label"]
        cat_meta[f"__cat_unit_refs__{c['key']}"] = c.get("has_unit_refs", True)
    pdf_bytes = _build_prep_pdf(ev, cat_meta)
    filename = f"preparacion_{(ev.get('reference') or ev.get('name','evento')).replace(' ', '_')}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@api_router.get("/events/{eid}/export")
async def export_event_pdf(eid: str, user: dict = Depends(get_current_user)):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if user.get("role") == "tecnico" and user["id"] not in (ev.get("assigned_technicians") or []):
        raise HTTPException(403, "Sin acceso a este evento")
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
async def stats(user: dict = Depends(get_current_user)):
    total_materials = await db.materials.count_documents({})
    total_units = await db.units.count_documents({})
    total_events = await db.events.count_documents({})
    open_events = await db.events.count_documents({"status": "abierto"})
    closed_events = await db.events.count_documents({"status": "cerrado"})
    incidents = await db.units.count_documents({"status": {"$in": ["broken", "repair"]}})
    prep_ready = await db.events.count_documents({"status": "abierto", "prep_status": "preparado"})
    prep_pending = await db.events.count_documents({"status": "abierto", "prep_status": {"$ne": "preparado"}})
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
        "prep_ready": prep_ready,
        "prep_pending": prep_pending,
        "by_category": by_cat,
    }


@api_router.get("/")
async def root():
    return {"app": "Edison Rent", "ok": True}


# ============================================================
# AUTH
# ============================================================


async def seed_admin():
    """Create admin user if no users exist."""
    if await db.users.count_documents({}) == 0:
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
        admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
        admin_name = os.environ.get("ADMIN_NAME", "Admin")
        u = User(email=admin_email, password_hash=hash_password(admin_password),
                 name=admin_name, role="productor")
        await db.users.insert_one(u.model_dump())
        logger.info(f"Admin sembrado: {admin_email}")
    # Cuentas internas protegidas (sin email real)
    # - Taller: usuario y contraseña "Taller"
    if not await db.users.find_one({"email": "taller"}, {"_id": 0}):
        t = User(email="taller", password_hash=hash_password("Taller"),
                 name="Taller de reparaciones", role="taller", protected=True)
        await db.users.insert_one(t.model_dump())
        logger.info("Cuenta interna Taller sembrada")
    else:
        # asegurar protected=True por si la cuenta existía antes
        await db.users.update_one({"email": "taller"}, {"$set": {"protected": True, "role": "taller"}})
    # - Almacén fijo: usuario "almacen", contraseña "Almacén"
    if not await db.users.find_one({"email": "almacen"}, {"_id": 0}):
        a = User(email="almacen", password_hash=hash_password("Almacén"),
                 name="Almacén", role="almacen", protected=True)
        await db.users.insert_one(a.model_dump())
        logger.info("Cuenta interna Almacén sembrada")
    else:
        await db.users.update_one({"email": "almacen"}, {"$set": {"protected": True, "role": "almacen"}})
    # ensure indexes
    try:
        await db.users.create_index("email", unique=True)
        await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        pass


def _public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u.get("name", ""),
            "phone": u.get("phone", ""),
            "role": u.get("role", "tecnico"), "active": u.get("active", True),
            "protected": u.get("protected", False)}


@api_router.post("/auth/login")
async def auth_login(payload: LoginRequest, response: Response):
    raw = payload.email.strip()
    normalized = _normalize_login(raw)
    # Try exact match first (real emails preserve dots/etc), then normalized for usernames
    user = await db.users.find_one({"email": raw.lower()}, PROJ)
    if not user:
        user = await db.users.find_one({"email": normalized}, PROJ)
    if not user or not user.get("active", True):
        raise HTTPException(401, "Credenciales inválidas")
    # Para cuentas protegidas (Taller/Almacén) aceptamos la contraseña con o sin acentos
    password_ok = verify_password(payload.password, user["password_hash"])
    if not password_ok and user.get("protected"):
        # cuentas internas: tolerar acentos en la contraseña (ej. "Almacen" vs "Almacén")
        stripped = _strip_accents(payload.password)
        if stripped != payload.password:
            password_ok = verify_password(stripped, user["password_hash"])
    if not password_ok:
        raise HTTPException(401, "Credenciales inválidas")
    access = create_access_token(user["id"], user["email"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"user": _public_user(user), "access_token": access, "refresh_token": refresh}


@api_router.post("/auth/logout")
async def auth_logout(response: Response, user: dict = Depends(get_current_user)):
    clear_auth_cookies(response)
    return {"ok": True}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return _public_user(user)


@api_router.post("/auth/refresh")
async def auth_refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        auth_h = request.headers.get("Authorization", "")
        if auth_h.startswith("Bearer "):
            token = auth_h[7:]
    if not token:
        raise HTTPException(401, "No refresh token")
    try:
        payload = decode_token(token)
        if payload.get("type") != "refresh":
            raise HTTPException(401, "Token inválido")
    except _jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expirado")
    except _jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")
    user = await db.users.find_one({"id": payload["sub"]}, PROJ)
    if not user or not user.get("active", True):
        raise HTTPException(401, "Usuario no válido")
    access = create_access_token(user["id"], user["email"])
    response.set_cookie("access_token", access, httponly=True, secure=False,
                        samesite="lax", max_age=60 * 60 * 24 * 7, path="/")
    return {"access_token": access}


@api_router.post("/auth/change-password")
async def change_password(payload: ChangePasswordRequest, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]}, PROJ)
    if not verify_password(payload.old_password, full["password_hash"]):
        raise HTTPException(400, "Contraseña actual incorrecta")
    if len(payload.new_password) < 8:
        raise HTTPException(400, "La nueva contraseña debe tener al menos 8 caracteres")
    await db.users.update_one({"id": user["id"]},
                              {"$set": {"password_hash": hash_password(payload.new_password)}})
    return {"ok": True}


@api_router.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest):
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email}, PROJ)
    # always 200 to avoid email enumeration
    if user:
        tok = gen_reset_token()
        await db.password_reset_tokens.insert_one({
            "token": tok, "user_id": user["id"],
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
            "used": False,
        })
        reset_url = f"{os.environ.get('APP_PUBLIC_URL', '')}/reset-password?token={tok}"
        logger.info(f"[PASSWORD RESET] {email} → token: {tok}")
        try:
            html = render_basic(
                title="Restablecer contraseña",
                body_html=(f"Hola {user.get('name') or ''}, hemos recibido una solicitud para "
                           "restablecer tu contraseña. Si has sido tú, pulsa el botón para "
                           "elegir una nueva. El enlace caduca en 1 hora."),
                cta_label="Restablecer contraseña",
                cta_url=reset_url,
                footer="Si no has solicitado este cambio, ignora este mensaje. Edison Rent",
            )
            await send_email(email, "Restablecer contraseña · Edison Rent", html)
        except Exception as e:
            logger.error("forgot_password email error: %s", e)
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordRequest):
    rec = await db.password_reset_tokens.find_one({"token": payload.token, "used": False}, PROJ)
    if not rec:
        raise HTTPException(400, "Token inválido o ya usado")
    exp = rec["expires_at"]
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(400, "Token expirado")
    if len(payload.new_password) < 8:
        raise HTTPException(400, "La nueva contraseña debe tener al menos 8 caracteres")
    await db.users.update_one({"id": rec["user_id"]},
                              {"$set": {"password_hash": hash_password(payload.new_password)}})
    await db.password_reset_tokens.update_one({"token": payload.token}, {"$set": {"used": True}})
    return {"ok": True}


# ---------- User management (productor only) ----------
@api_router.get("/users")
async def list_users(user: dict = Depends(require_role("productor"))):
    users = await db.users.find({}, PROJ).sort("name", 1).to_list(500)
    return [_public_user(u) for u in users]


@api_router.get("/technicians")
async def list_technicians(user: dict = Depends(get_current_user)):
    """List of technicians (and productores) for event assignment. Visible to productor + almacen."""
    if user.get("role") == "tecnico":
        raise HTTPException(403, "Sin permisos")
    users = await db.users.find({"role": {"$in": ["tecnico", "productor"]}, "active": True}, PROJ).sort("name", 1).to_list(500)
    return [_public_user(u) for u in users]


@api_router.post("/users")
async def create_user(payload: RegisterRequest, user: dict = Depends(require_role("productor"))):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "Email inválido")
    if payload.role not in ROLES:
        raise HTTPException(400, "Rol inválido")
    if len(payload.password) < 8:
        raise HTTPException(400, "Contraseña mínimo 8 caracteres")
    if await db.users.find_one({"email": email}, PROJ):
        raise HTTPException(400, "Ya existe un usuario con ese email")
    u = User(email=email, password_hash=hash_password(payload.password),
             name=payload.name.strip(), phone=(payload.phone or "").strip(), role=payload.role)
    await db.users.insert_one(u.model_dump())
    # welcome email with initial password
    try:
        public_url = os.environ.get("APP_PUBLIC_URL", "")
        html = render_basic(
            title="Bienvenido a Edison Rent",
            body_html=(f"Hola {u.name or u.email}, se te ha creado una cuenta como "
                       f"<b>{u.role}</b> en Edison Rent.<br><br>"
                       f"<b>Email:</b> {u.email}<br>"
                       f"<b>Contraseña temporal:</b> <code>{payload.password}</code><br><br>"
                       "Cámbiala desde tu perfil después del primer acceso."),
            cta_label="Acceder",
            cta_url=f"{public_url}/login",
            footer="Edison Rent",
        )
        await send_email(u.email, "Tu acceso a Edison Rent", html)
    except Exception as e:
        logger.error("welcome email error: %s", e)
    return _public_user(u.model_dump())


@api_router.put("/users/{uid}")
async def update_user(uid: str, payload: UpdateUserRequest, user: dict = Depends(require_role("productor"))):
    target = await db.users.find_one({"id": uid}, PROJ)
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    upd = {}
    if payload.name is not None:
        upd["name"] = payload.name.strip()
    if payload.phone is not None:
        upd["phone"] = payload.phone.strip()
    if payload.role is not None:
        if payload.role not in ROLES:
            raise HTTPException(400, "Rol inválido")
        upd["role"] = payload.role
    if payload.active is not None:
        # don't allow deactivating yourself
        if uid == user["id"] and payload.active is False:
            raise HTTPException(400, "No puedes desactivarte a ti mismo")
        upd["active"] = payload.active
    if upd:
        await db.users.update_one({"id": uid}, {"$set": upd})
    return _public_user(await db.users.find_one({"id": uid}, PROJ))


@api_router.post("/users/{uid}/reset-password")
async def admin_reset_password(uid: str, payload: dict, user: dict = Depends(require_role("productor"))):
    new_password = payload.get("new_password", "")
    if len(new_password) < 8:
        raise HTTPException(400, "Contraseña mínimo 8 caracteres")
    target = await db.users.find_one({"id": uid}, PROJ)
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    await db.users.update_one({"id": uid}, {"$set": {"password_hash": hash_password(new_password)}})
    return {"ok": True}


@api_router.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_role("productor"))):
    if uid == user["id"]:
        raise HTTPException(400, "No puedes eliminarte a ti mismo")
    target = await db.users.find_one({"id": uid}, PROJ)
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    if target.get("protected"):
        raise HTTPException(400, "No se puede eliminar una cuenta interna protegida")
    await db.users.delete_one({"id": uid})
    return {"ok": True}


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
    await seed_admin()
    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
