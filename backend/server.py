from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import io
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict
import uuid
from datetime import datetime, timezone

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
LOGO_PATH = ROOT_DIR / "assets" / "logo.png"

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

Category = Literal["audio", "video", "luces", "estructuras"]
EventType = Literal["alquiler", "bolo"]
EventStatus = Literal["abierto", "cerrado"]

CAT_PREFIX = {"audio": "AUD", "video": "VID", "luces": "LUC", "estructuras": "EST"}
PROJ = {"_id": 0}


# ---------- Models ----------
class SubItemDef(BaseModel):
    material_id: str
    name: str = ""
    quantity_per_parent: int = 1


class Material(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: Category
    name: str
    reference: str = ""
    quantity: int = 0
    blocked: int = 0
    subitems: List[SubItemDef] = []


class MaterialCreate(BaseModel):
    category: Category
    name: str
    reference: Optional[str] = None
    quantity: int = 0
    subitems: List[SubItemDef] = []


class MaterialUpdate(BaseModel):
    category: Optional[Category] = None
    name: Optional[str] = None
    reference: Optional[str] = None
    quantity: Optional[int] = None
    subitems: Optional[List[SubItemDef]] = None


class SubItemSnapshot(BaseModel):
    material_id: str
    name: str
    qty: int


class EventMaterial(BaseModel):
    material_id: str
    name: str
    category: str
    reference: str = ""
    quantity: int
    subitems: List[SubItemSnapshot] = []


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
    # Datetime-aware fields (ISO local: YYYY-MM-DDTHH:MM)
    warehouse_out_dt: Optional[str] = None
    return_dt: Optional[str] = None             # alquiler
    setup_start_dt: Optional[str] = None        # bolo
    setup_end_dt: Optional[str] = None          # bolo
    act_start_dt: Optional[str] = None          # bolo
    act_end_dt: Optional[str] = None            # bolo
    dismount_start_dt: Optional[str] = None     # bolo
    dismount_end_dt: Optional[str] = None       # bolo
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


class EventUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[EventType] = None
    client_name: Optional[str] = None
    client_contact: Optional[str] = None
    reference: Optional[str] = None
    location: Optional[str] = None
    setup_date: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None
    schedule: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[EventStatus] = None
    warehouse_out_dt: Optional[str] = None
    return_dt: Optional[str] = None
    setup_start_dt: Optional[str] = None
    setup_end_dt: Optional[str] = None
    act_start_dt: Optional[str] = None
    act_end_dt: Optional[str] = None
    dismount_start_dt: Optional[str] = None
    dismount_end_dt: Optional[str] = None


class BlockMaterialRequest(BaseModel):
    material_id: str
    quantity: int


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


# ---------- Helpers ----------
async def next_reference(category: str) -> str:
    prefix = CAT_PREFIX.get(category, "REF")
    cursor = db.materials.find({"category": category, "reference": {"$regex": f"^{prefix}-"}}, {"reference": 1, "_id": 0})
    max_n = 0
    async for d in cursor:
        try:
            n = int(d["reference"].split("-", 1)[1])
            if n > max_n:
                max_n = n
        except Exception:
            pass
    return f"{prefix}-{max_n + 1:04d}"


def parse_dt(s: Optional[str]) -> Optional[datetime]:
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
    """Returns (start_dt, end_dt) representing when event holds material."""
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


def event_consumption(ev: dict, exclude_material_id: Optional[str] = None) -> Dict[str, int]:
    cons: Dict[str, int] = {}
    for em in ev.get("materials", []):
        if exclude_material_id and em["material_id"] == exclude_material_id:
            continue
        cons[em["material_id"]] = cons.get(em["material_id"], 0) + em["quantity"]
        for si in em.get("subitems", []):
            cons[si["material_id"]] = cons.get(si["material_id"], 0) + si["qty"]
    return cons


async def seed_inventory_if_empty():
    count = await db.materials.count_documents({})
    if count > 0:
        # migration: ensure reference/subitems exist
        cursor = db.materials.find({"$or": [{"reference": {"$exists": False}}, {"reference": ""}]})
        async for d in cursor:
            ref = await next_reference(d["category"])
            await db.materials.update_one({"id": d["id"]}, {"$set": {"reference": ref}})
        await db.materials.update_many({"subitems": {"$exists": False}}, {"$set": {"subitems": []}})
        return
    seed_path = ROOT_DIR / "seed_inventory.json"
    if not seed_path.exists():
        return
    with open(seed_path, "r", encoding="utf-8") as f:
        items = json.load(f)
    counters: Dict[str, int] = {}
    docs = []
    for it in items:
        cat = it["category"]
        counters[cat] = counters.get(cat, 0) + 1
        ref = f"{CAT_PREFIX.get(cat, 'REF')}-{counters[cat]:04d}"
        m = Material(category=cat, name=it["name"], quantity=int(it["quantity"]), reference=ref)
        docs.append(m.model_dump())
    if docs:
        await db.materials.insert_many(docs)


# ---------- Materials ----------
@api_router.get("/materials", response_model=List[Material])
async def list_materials(category: Optional[str] = None, q: Optional[str] = None):
    query = {}
    if category:
        query["category"] = category
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"reference": {"$regex": q, "$options": "i"}},
        ]
    items = await db.materials.find(query, PROJ).sort("reference", 1).to_list(5000)
    for it in items:
        it.setdefault("subitems", [])
        it.setdefault("reference", "")
    return items


@api_router.post("/materials", response_model=Material)
async def create_material(payload: MaterialCreate):
    data = payload.model_dump()
    if not data.get("reference"):
        data["reference"] = await next_reference(data["category"])
    # Enrich subitems with snapshot name if missing
    enriched = []
    for s in data.get("subitems", []):
        if not s.get("name"):
            ref_m = await db.materials.find_one({"id": s["material_id"]}, PROJ)
            s["name"] = ref_m["name"] if ref_m else ""
        enriched.append(s)
    data["subitems"] = enriched
    m = Material(**data)
    await db.materials.insert_one(m.model_dump())
    return m


@api_router.put("/materials/{material_id}", response_model=Material)
async def update_material(material_id: str, payload: MaterialUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "subitems" in update:
        enriched = []
        for s in update["subitems"]:
            if not s.get("name"):
                ref_m = await db.materials.find_one({"id": s["material_id"]}, PROJ)
                s["name"] = ref_m["name"] if ref_m else ""
            enriched.append(s)
        update["subitems"] = enriched
    if not update:
        raise HTTPException(400, "No fields to update")
    res = await db.materials.find_one_and_update(
        {"id": material_id}, {"$set": update}, return_document=True, projection=PROJ
    )
    if not res:
        raise HTTPException(404, "Material not found")
    res.setdefault("subitems", [])
    res.setdefault("reference", "")
    return res


@api_router.delete("/materials/{material_id}")
async def delete_material(material_id: str):
    m = await db.materials.find_one({"id": material_id}, PROJ)
    if not m:
        raise HTTPException(404, "Material not found")
    if m.get("blocked", 0) > 0:
        raise HTTPException(400, "Material está bloqueado en eventos. Desbloquéalo primero.")
    await db.materials.delete_one({"id": material_id})
    return {"ok": True}


# ---------- Providers ----------
@api_router.get("/providers", response_model=List[Provider])
async def list_providers():
    items = await db.providers.find({}, PROJ).sort("name", 1).to_list(1000)
    return items


@api_router.post("/providers", response_model=Provider)
async def create_provider(payload: ProviderCreate):
    p = Provider(**payload.model_dump())
    await db.providers.insert_one(p.model_dump())
    return p


@api_router.put("/providers/{pid}", response_model=Provider)
async def update_provider(pid: str, payload: ProviderCreate):
    update = payload.model_dump()
    res = await db.providers.find_one_and_update(
        {"id": pid}, {"$set": update}, return_document=True, projection=PROJ
    )
    if not res:
        raise HTTPException(404, "Provider not found")
    return res


@api_router.delete("/providers/{pid}")
async def delete_provider(pid: str):
    p = await db.providers.find_one({"id": pid}, PROJ)
    if not p:
        raise HTTPException(404, "Provider not found")
    await db.providers.delete_one({"id": pid})
    # cleanup orphan rentals references (do not remove rentals, just blank provider)
    await db.events.update_many(
        {"rentals.provider_id": pid},
        {"$set": {"rentals.$[r].provider_id": None}},
        array_filters=[{"r.provider_id": pid}],
    )
    return {"ok": True}


# ---------- Events ----------
@api_router.get("/events", response_model=List[Event])
async def list_events():
    items = await db.events.find({}, PROJ).sort("event_date", 1).to_list(5000)
    return items


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
    docs = []
    for ec in payload.events:
        e = Event(**ec.model_dump())
        docs.append(e.model_dump())
    if docs:
        await db.events.insert_many(docs)
    return {"created": len(docs)}


@api_router.put("/events/{eid}", response_model=Event)
async def update_event(eid: str, payload: EventUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    res = await db.events.find_one_and_update(
        {"id": eid}, {"$set": update}, return_document=True, projection=PROJ
    )
    if not res:
        raise HTTPException(404, "Event not found")
    return res


@api_router.delete("/events/{eid}")
async def delete_event(eid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    for em in ev.get("materials", []):
        await db.materials.update_one({"id": em["material_id"]}, {"$inc": {"blocked": -int(em["quantity"])}})
        for si in em.get("subitems", []):
            await db.materials.update_one({"id": si["material_id"]}, {"$inc": {"blocked": -int(si["qty"])}})
    await db.events.delete_one({"id": eid})
    return {"ok": True}


@api_router.post("/events/{eid}/materials", response_model=Event)
async def block_material(eid: str, payload: BlockMaterialRequest):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    if payload.quantity < 0:
        raise HTTPException(400, "Cantidad inválida")
    M = await db.materials.find_one({"id": payload.material_id}, PROJ)
    if not M:
        raise HTTPException(404, "Material not found")

    # Build new subitems snapshot from current material def
    new_subitems = []
    for s in M.get("subitems", []):
        new_subitems.append({
            "material_id": s["material_id"],
            "name": s.get("name", ""),
            "qty": int(s.get("quantity_per_parent", 1)) * int(payload.quantity),
        })

    # Compute combined consumption for THIS event after applying change
    cons = event_consumption(ev, exclude_material_id=payload.material_id)
    if payload.quantity > 0:
        cons[payload.material_id] = cons.get(payload.material_id, 0) + payload.quantity
        for si in new_subitems:
            cons[si["material_id"]] = cons.get(si["material_id"], 0) + si["qty"]

    # Validate stock against overlapping events
    cw = event_window(ev)
    others = await db.events.find({"id": {"$ne": eid}}, PROJ).to_list(5000)
    for mid, total_needed in cons.items():
        Mref = await db.materials.find_one({"id": mid}, PROJ)
        if not Mref:
            raise HTTPException(400, "Subítem referenciado no existe")
        other_block = 0
        for oev in others:
            ow = event_window(oev)
            if overlaps(cw, ow):
                ocons = event_consumption(oev)
                other_block += ocons.get(mid, 0)
        if total_needed + other_block > Mref["quantity"]:
            raise HTTPException(
                400,
                f"Stock insuficiente para {Mref['name']}. Necesita {total_needed}, ya en otros eventos solapados: {other_block}, total: {Mref['quantity']}"
            )

    # Apply: remove existing entry & decrement counters
    existing = next((em for em in ev.get("materials", []) if em["material_id"] == payload.material_id), None)
    if existing:
        await db.materials.update_one({"id": payload.material_id}, {"$inc": {"blocked": -int(existing["quantity"])}})
        for si in existing.get("subitems", []):
            await db.materials.update_one({"id": si["material_id"]}, {"$inc": {"blocked": -int(si["qty"])}})
        await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": payload.material_id}}})

    if payload.quantity > 0:
        em_doc = {
            "material_id": payload.material_id,
            "name": M["name"],
            "category": M["category"],
            "reference": M.get("reference", ""),
            "quantity": int(payload.quantity),
            "subitems": new_subitems,
        }
        await db.events.update_one({"id": eid}, {"$push": {"materials": em_doc}})
        await db.materials.update_one({"id": payload.material_id}, {"$inc": {"blocked": int(payload.quantity)}})
        for si in new_subitems:
            await db.materials.update_one({"id": si["material_id"]}, {"$inc": {"blocked": int(si["qty"])}})

    return await db.events.find_one({"id": eid}, PROJ)


@api_router.delete("/events/{eid}/materials/{material_id}", response_model=Event)
async def unblock_material(eid: str, material_id: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    existing = next((em for em in ev.get("materials", []) if em["material_id"] == material_id), None)
    if not existing:
        raise HTTPException(404, "Material no bloqueado en este evento")
    await db.materials.update_one({"id": material_id}, {"$inc": {"blocked": -int(existing["quantity"])}})
    for si in existing.get("subitems", []):
        await db.materials.update_one({"id": si["material_id"]}, {"$inc": {"blocked": -int(si["qty"])}})
    await db.events.update_one({"id": eid}, {"$pull": {"materials": {"material_id": material_id}}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/rentals", response_model=Event)
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
        provider_id=payload.provider_id, provider_name=provider_name,
        notes=payload.notes,
    )
    await db.events.update_one({"id": eid}, {"$push": {"rentals": item.model_dump()}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.delete("/events/{eid}/rentals/{rid}", response_model=Event)
async def remove_rental(eid: str, rid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    await db.events.update_one({"id": eid}, {"$pull": {"rentals": {"id": rid}}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/close", response_model=Event)
async def close_event(eid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    await db.events.update_one({"id": eid}, {"$set": {"status": "cerrado"}})
    return await db.events.find_one({"id": eid}, PROJ)


@api_router.post("/events/{eid}/reopen", response_model=Event)
async def reopen_event(eid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    await db.events.update_one({"id": eid}, {"$set": {"status": "abierto"}})
    return await db.events.find_one({"id": eid}, PROJ)


# ---------- PDF Export ----------
def _fmt_dt(s):
    if not s:
        return "—"
    d = parse_dt(s)
    if not d:
        return s
    return d.strftime("%d/%m/%Y %H:%M") if "T" in str(s) else d.strftime("%d/%m/%Y")


def _build_pdf(event: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=1.5 * cm, bottomMargin=2 * cm,
        title=f"Evento {event.get('name','')}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "title", parent=styles["Heading1"], fontSize=20, textColor=colors.HexColor("#1c1917"),
        spaceAfter=2, fontName="Helvetica-Bold",
    )
    sub_style = ParagraphStyle(
        "sub", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#78716c"),
        spaceAfter=10,
    )
    h2 = ParagraphStyle(
        "h2", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#b45309"),
        spaceBefore=14, spaceAfter=6, fontName="Helvetica-Bold",
    )
    body = styles["Normal"]
    sub_body = ParagraphStyle(
        "subbody", parent=body, fontSize=9, fontName="Helvetica-Oblique",
        textColor=colors.HexColor("#57534e"), leftIndent=18,
    )
    story = []

    # Header with logo
    if LOGO_PATH.exists():
        try:
            logo = Image(str(LOGO_PATH), width=3.0 * cm, height=3.0 * cm)
            logo.hAlign = "LEFT"
            type_label = "BOLO" if event.get("type") == "bolo" else "ALQUILER"
            status_label = "Cerrado" if event.get("status") == "cerrado" else "Abierto"
            head_right = Paragraph(
                f"<b>{event.get('name','Evento')}</b><br/>"
                f"<font size=9 color='#78716c'>{type_label} · {status_label}</font>",
                ParagraphStyle("hr", parent=body, fontSize=14, alignment=2)
            )
            head_tbl = Table([[logo, head_right]], colWidths=[3.5 * cm, 13 * cm])
            head_tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#1c1917")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]))
            story.append(head_tbl)
            story.append(Spacer(1, 8))
        except Exception:
            story.append(Paragraph(event.get("name", "Evento"), title_style))
    else:
        story.append(Paragraph(event.get("name", "Evento"), title_style))
        type_label = "Bolo" if event.get("type") == "bolo" else "Alquiler simple"
        status_label = "Cerrado" if event.get("status") == "cerrado" else "Abierto"
        story.append(Paragraph(f"{type_label} · {status_label}", sub_style))

    # Info table
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
    info_rows += [
        ["Fecha acto", event.get("event_date") or "—"],
        ["Horarios", event.get("schedule") or "—"],
    ]
    info_tbl = Table(info_rows, colWidths=[4 * cm, 12 * cm])
    info_tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#374151")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
    ]))
    story.append(info_tbl)

    if event.get("notes"):
        story.append(Paragraph("Notas", h2))
        story.append(Paragraph(event["notes"].replace("\n", "<br/>"), body))

    # Materials grouped by category
    materials = event.get("materials", [])
    if materials:
        story.append(Paragraph("Material bloqueado del stock", h2))
        by_cat = {}
        for m in materials:
            by_cat.setdefault(m["category"], []).append(m)
        for cat in ["audio", "video", "luces", "estructuras"]:
            if cat in by_cat:
                story.append(Paragraph(cat.capitalize(), ParagraphStyle(
                    "cat", parent=body, fontSize=11, textColor=colors.HexColor("#111827"),
                    spaceBefore=4, spaceAfter=2, fontName="Helvetica-Bold"
                )))
                for m in sorted(by_cat[cat], key=lambda x: x.get("reference") or x["name"]):
                    ref = m.get("reference", "")
                    main_line = f"<b>{ref + ' · ' if ref else ''}{m['name']}</b> &nbsp;&nbsp; <font color='#78716c'>x{m['quantity']}</font>"
                    story.append(Paragraph(main_line, ParagraphStyle("mline", parent=body, fontSize=10, spaceBefore=2, spaceAfter=1)))
                    for si in m.get("subitems", []):
                        story.append(Paragraph(f"↳ {si['name']} <font color='#78716c'>x{si['qty']}</font>", sub_body))

    # Rentals
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
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
        ]))
        story.append(t)

    if not materials and not rentals:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Sin material asignado.", body))

    # Signature box for alquiler
    if event.get("type") == "alquiler":
        story.append(Spacer(1, 30))
        story.append(Paragraph("<b>Conformidad y firma del cliente</b>", h2))
        story.append(Paragraph(
            "El cliente declara haber recibido el material en buen estado y se compromete a su devolución en las mismas condiciones.",
            ParagraphStyle("decl", parent=body, fontSize=9, textColor=colors.HexColor("#57534e"))
        ))
        story.append(Spacer(1, 10))
        sig = Table([
            ["Nombre y DNI", "Firma"],
            ["", ""],
        ], colWidths=[8 * cm, 8 * cm], rowHeights=[0.7 * cm, 3 * cm])
        sig.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#57534e")),
            ("BOX", (0, 1), (0, 1), 0.5, colors.HexColor("#1c1917")),
            ("BOX", (1, 1), (1, 1), 0.5, colors.HexColor("#1c1917")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(sig)
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            f"Fecha: ____ / ____ / ________",
            ParagraphStyle("sigd", parent=body, fontSize=10, textColor=colors.HexColor("#57534e"))
        ))

    story.append(Spacer(1, 18))
    story.append(Paragraph(
        f"Generado el {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')} · Edison",
        ParagraphStyle("foot", parent=body, fontSize=8, textColor=colors.HexColor("#9ca3af"))
    ))

    doc.build(story)
    return buf.getvalue()


@api_router.get("/events/{eid}/export")
async def export_event_pdf(eid: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    pdf_bytes = _build_pdf(ev)
    filename = f"evento_{(ev.get('reference') or ev.get('name','evento')).replace(' ', '_')}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ---------- Stats ----------
@api_router.get("/stats")
async def stats():
    total_materials = await db.materials.count_documents({})
    total_events = await db.events.count_documents({})
    open_events = await db.events.count_documents({"status": "abierto"})
    closed_events = await db.events.count_documents({"status": "cerrado"})
    by_cat_cursor = db.materials.aggregate([
        {"$group": {"_id": "$category", "count": {"$sum": 1}, "qty": {"$sum": "$quantity"}, "blocked": {"$sum": "$blocked"}}}
    ])
    by_cat = {}
    async for row in by_cat_cursor:
        by_cat[row["_id"]] = {"count": row["count"], "qty": row["qty"], "blocked": row["blocked"]}
    return {
        "total_materials": total_materials,
        "total_events": total_events,
        "open_events": open_events,
        "closed_events": closed_events,
        "by_category": by_cat,
    }


@api_router.get("/")
async def root():
    return {"app": "Stock Eventos", "ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def on_startup():
    await seed_inventory_if_empty()
    logger.info("Seed/migration check complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
