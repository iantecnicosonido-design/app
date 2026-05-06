# Stock Eventos - PRD

## Original Problem Statement
App en español para controlar el stock de material de empresa de eventos. Categorías: audio, video, luces, estructuras (precargadas desde PDFs Edison Bryan). Calendario de eventos, bloqueo de material por evento, exportación a PDF al cerrar, ficha del evento (alquiler simple o bolo, fecha montaje, fecha acto, horarios, ubicación, nº referencia bolo, nombre cliente), opción de añadir material de alquiler externo discriminando empresa proveedora.

## User Choices
- Sin login (acceso libre, app interna)
- Inventario precargado desde PDFs (262 referencias originales, hoy 308)
- PDF generado en servidor (reportlab)
- Bloqueo resta del stock disponible
- Lista de empresas proveedoras gestionable
- Categorías dinámicas (añadibles desde UI) con flags `has_unit_refs` y `has_subitems`
- Categoría "Cables" sin numeración por unidad ni subítems (solo nombre + cantidad)

## Architecture
- Backend: FastAPI + Motor (MongoDB async) + reportlab para PDF. Todos los endpoints bajo `/api`.
- Frontend: React 19 + Tailwind + shadcn/ui + sonner + react-router-dom. Tipografía Outfit + JetBrains Mono. Tema cream/zinc con acento ámbar.
- Datos clave:
  - `categories`: {id, key, label, prefix, has_subitems, has_unit_refs, order}
  - `materials`: {id, category, reference, name, quantity, blocked}
  - `units`: {id, material_id, reference, status, subitems[], notes}
  - `events`: {id, name, type, client_name, reference, location, setup_date, event_date, end_date, schedule, warehouse_out_dt, setup_start_dt, setup_end_dt, act_start_dt, act_end_dt, dismount_start_dt, dismount_end_dt, return_dt, notes, status, materials[], rentals[]}
  - `packs`: {id, name, description, items[]}
  - `incidents`: {id, unit_id, description, status}
  - `providers`: {id, name, contact, phone, email, notes}

## Implementation (latest 06-May-2026)
- ✅ Seed automático de inventario (308 ítems, 1491 unidades)
- ✅ CRUD materiales + unidades + subítems
- ✅ Categorías dinámicas (CRUD desde UI con switches has_unit_refs / has_subitems)
- ✅ Categoría "Cables" migrada (39 items) sin unit refs ni subitems
- ✅ Eventos (bolo/alquiler) con ventana de bloqueo precisa
- ✅ Bloqueo/desbloqueo a nivel de unidad
- ✅ Packs de material
- ✅ Incidencias por unidad
- ✅ Timeline mensual
- ✅ PDF con logo Edison Bryan
- ✅ Dashboard + calendarios

## Fixes recientes (06-May-2026)
- Bug: crash al abrir eventos por `grouped[c.key]` con categorías dinámicas → fix en `EventDetail.jsx`, `Inventory.jsx`, `Packs.jsx` (usan `/api/categories` dinámicamente)
- UI: categoría "Cables" ya no muestra desglose por unidad en la vista de evento (solo nombre + cantidad)

## Backlog
### P1
- Incidencias: añadir textarea para descripción extensa de la avería
- Incidencias: subida de fotos (jpg/png) y PDF adjuntos, con preview
- Logo personalizable en PDF (actualmente fijo)

### P2
- Importar/exportar inventario en CSV
- Histórico de movimientos/incidencias por unidad (ver en qué eventos ha estado y sus averías)
- Notificaciones email/WhatsApp al cerrar evento con PDF adjunto

## Key Files
- `/app/backend/server.py` - FastAPI app (incluye PDF + categorías dinámicas)
- `/app/backend/seed_inventory.json` - seed
- `/app/frontend/src/App.js` - rutas
- `/app/frontend/src/pages/{Dashboard,Inventory,Events,EventDetail,Providers,Packs,Incidents,Timeline}.jsx`
- `/app/frontend/src/components/{Layout,SearchSelect}.jsx`
- `/app/frontend/src/lib/api.js` - axios instance + helpers
