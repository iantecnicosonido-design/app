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
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, date

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

Category = Literal["audio", "video", "luces", "estructuras"]
EventType = Literal["alquiler", "bolo"]
EventStatus = Literal["abierto", "cerrado"]


# ---------- Models ----------
class Material(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: Category
    name: str
    quantity: int = 0       # total stock
    blocked: int = 0        # currently blocked across events


class MaterialCreate(BaseModel):
    category: Category
    name: str
    quantity: int = 0


class MaterialUpdate(BaseModel):
    category: Optional[Category] = None
    name: Optional[str] = None
    quantity: Optional[int] = None


class EventMaterial(BaseModel):
    material_id: str
    name: str
    category: str
    quantity: int


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
    reference: str = ""
    location: str = ""
    setup_date: Optional[str] = None     # ISO date
    event_date: Optional[str] = None     # ISO date
    end_date: Optional[str] = None       # ISO date
    schedule: str = ""                   # free text horarios
    notes: str = ""
    status: EventStatus = "abierto"
    materials: List[EventMaterial] = []
    rentals: List[RentalItem] = []
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EventCreate(BaseModel):
    name: str
    type: EventType = "alquiler"
    client_name: str = ""
    reference: str = ""
    location: str = ""
    setup_date: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None
    schedule: str = ""
    notes: str = ""


class EventUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[EventType] = None
    client_name: Optional[str] = None
    reference: Optional[str] = None
    location: Optional[str] = None
    setup_date: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None
    schedule: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[EventStatus] = None


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


# ---------- Helpers ----------
PROJ = {"_id": 0}


async def seed_inventory_if_empty():
    count = await db.materials.count_documents({})
    if count > 0:
        return
    seed_path = ROOT_DIR / "seed_inventory.json"
    if not seed_path.exists():
        return
    with open(seed_path, "r", encoding="utf-8") as f:
        items = json.load(f)
    docs = []
    for it in items:
        m = Material(category=it["category"], name=it["name"], quantity=int(it["quantity"]))
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
        query["name"] = {"$regex": q, "$options": "i"}
    items = await db.materials.find(query, PROJ).sort("name", 1).to_list(5000)
    return items


@api_router.post("/materials", response_model=Material)
async def create_material(payload: MaterialCreate):
    m = Material(**payload.model_dump())
    await db.materials.insert_one(m.model_dump())
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
    await db.providers.delete_one({"id": pid})
    return {"ok": True}


# ---------- Events ----------
@api_router.get("/events", response_model=List[Event])
async def list_events():
    items = await db.events.find({}, PROJ).sort("event_date", 1).to_list(2000)
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
    # Restore blocked stock
    for m in ev.get("materials", []):
        await db.materials.update_one(
            {"id": m["material_id"]},
            {"$inc": {"blocked": -int(m["quantity"])}}
        )
    await db.events.delete_one({"id": eid})
    return {"ok": True}


@api_router.post("/events/{eid}/materials", response_model=Event)
async def block_material(eid: str, payload: BlockMaterialRequest):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado, no se puede modificar")
    mat = await db.materials.find_one({"id": payload.material_id}, PROJ)
    if not mat:
        raise HTTPException(404, "Material not found")
    available = mat["quantity"] - mat.get("blocked", 0)
    # If material already in event, treat as delta
    existing = next((m for m in ev.get("materials", []) if m["material_id"] == payload.material_id), None)
    delta = payload.quantity - (existing["quantity"] if existing else 0)
    if delta > available:
        raise HTTPException(400, f"Stock insuficiente. Disponible: {available}")
    if payload.quantity < 0:
        raise HTTPException(400, "Cantidad inválida")
    # update material blocked counter
    await db.materials.update_one({"id": payload.material_id}, {"$inc": {"blocked": delta}})
    if existing:
        if payload.quantity == 0:
            await db.events.update_one(
                {"id": eid}, {"$pull": {"materials": {"material_id": payload.material_id}}}
            )
        else:
            await db.events.update_one(
                {"id": eid, "materials.material_id": payload.material_id},
                {"$set": {"materials.$.quantity": payload.quantity}}
            )
    else:
        if payload.quantity > 0:
            em = EventMaterial(
                material_id=payload.material_id,
                name=mat["name"],
                category=mat["category"],
                quantity=payload.quantity,
            )
            await db.events.update_one({"id": eid}, {"$push": {"materials": em.model_dump()}})
    updated = await db.events.find_one({"id": eid}, PROJ)
    return updated


@api_router.delete("/events/{eid}/materials/{material_id}", response_model=Event)
async def unblock_material(eid: str, material_id: str):
    ev = await db.events.find_one({"id": eid}, PROJ)
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev.get("status") == "cerrado":
        raise HTTPException(400, "Evento cerrado")
    existing = next((m for m in ev.get("materials", []) if m["material_id"] == material_id), None)
    if not existing:
        raise HTTPException(404, "Material no bloqueado en este evento")
    await db.materials.update_one({"id": material_id}, {"$inc": {"blocked": -int(existing["quantity"])}})
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
def _build_pdf(event: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
        title=f"Evento {event.get('name','')}",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "title", parent=styles["Heading1"], fontSize=20, textColor=colors.HexColor("#1f2937"),
        spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        "sub", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#6b7280"),
        spaceAfter=12,
    )
    h2 = ParagraphStyle(
        "h2", parent=styles["Heading2"], fontSize=13, textColor=colors.HexColor("#b45309"),
        spaceBefore=12, spaceAfter=6,
    )
    body = styles["Normal"]
    story = []
    story.append(Paragraph(event.get("name", "Evento"), title_style))
    type_label = "Bolo" if event.get("type") == "bolo" else "Alquiler"
    status_label = "Cerrado" if event.get("status") == "cerrado" else "Abierto"
    story.append(Paragraph(f"{type_label} · {status_label}", sub_style))

    info_rows = [
        ["Cliente", event.get("client_name") or "—"],
        ["Referencia", event.get("reference") or "—"],
        ["Ubicación", event.get("location") or "—"],
        ["Montaje", event.get("setup_date") or "—"],
        ["Acto", event.get("event_date") or "—"],
        ["Fin", event.get("end_date") or "—"],
        ["Horarios", event.get("schedule") or "—"],
    ]
    info_tbl = Table(info_rows, colWidths=[4 * cm, 12 * cm])
    info_tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#374151")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
    ]))
    story.append(info_tbl)

    if event.get("notes"):
        story.append(Paragraph("Notas", h2))
        story.append(Paragraph(event["notes"].replace("\n", "<br/>"), body))

    materials = event.get("materials", [])
    by_cat = {}
    for m in materials:
        by_cat.setdefault(m["category"], []).append(m)
    if materials:
        story.append(Paragraph("Material bloqueado del stock", h2))
        for cat in ["audio", "video", "luces", "estructuras"]:
            if cat in by_cat:
                story.append(Paragraph(cat.capitalize(), ParagraphStyle(
                    "cat", parent=body, fontSize=11, textColor=colors.HexColor("#111827"),
                    spaceBefore=6, spaceAfter=4, fontName="Helvetica-Bold"
                )))
                rows = [["Material", "Cant."]]
                for m in sorted(by_cat[cat], key=lambda x: x["name"]):
                    rows.append([m["name"], str(m["quantity"])])
                t = Table(rows, colWidths=[13 * cm, 3 * cm])
                t.setStyle(TableStyle([
                    ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
                    ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e5e7eb")),
                ]))
                story.append(t)

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

    story.append(Spacer(1, 18))
    story.append(Paragraph(
        f"Generado el {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
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
    logger.info("Inventory seed check complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
