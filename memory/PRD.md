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
- Categoría "Cables" sin numeración por unidad ni subítems
- Flightcases reutilizables para distribuir cableado por contenedor

## Architecture
- Backend: FastAPI + Motor (MongoDB async) + reportlab para PDF. Todos los endpoints bajo `/api`.
- Frontend: React 19 + Tailwind + shadcn/ui + sonner + react-router-dom. Tipografía Outfit + JetBrains Mono. Tema cream/zinc con acento ámbar.
- Datos clave:
  - `categories`: {id, key, label, prefix, has_subitems, has_unit_refs, order}
  - `materials`: {id, category, reference, name, quantity, blocked}
  - `units`: {id, material_id, reference, status, subitems[], notes}
  - `events`: {id, name, type, ..., materials[{material_id, units[{unit_id, reference, subitems[], flightcase}]}], rentals[]}
  - `flightcases`: {id, name, description, notes}
  - `packs`, `incidents`, `providers`

## Implementation
- ✅ Inventario seed (308 ítems / 1491 unidades)
- ✅ CRUD materiales/unidades/subítems/categorías/packs/incidencias/proveedores
- ✅ Eventos bolo/alquiler con ventana precisa
- ✅ Bloqueo unit-level + edición fina de unidades por material
- ✅ Categoría dinámica "Cables" (sin unit refs ni subitems)
- ✅ Flightcases CRUD + distribución de cableado (PUT /events/{id}/cable-distribution)
- ✅ PDF con logo y agrupación de cables por flightcase
- ✅ Timeline mensual + Dashboard

## Fixes recientes (06-07 May 2026)
- Bug crash al abrir eventos (categoría dinámica) → corregido en EventDetail/Inventory/Packs
- Cables sin desglose por unidad en eventos
- Edición de material bloqueado (Pencil → diálogo con checkboxes / cantidad)
- Distribución de cables por flightcase + PDF agrupa por flightcase

## Backlog
### P1
- Incidencias: textarea descripción larga + adjuntos (fotos/PDFs)
- Logo personalizable en PDF

### P2
- Importar/exportar inventario en CSV
- Histórico de movimientos por unidad
- Notificaciones email/WhatsApp al cerrar evento

## Key Files
- `/app/backend/server.py`
- `/app/backend/seed_inventory.json`
- `/app/frontend/src/App.js` · rutas
- `/app/frontend/src/pages/{Dashboard,Inventory,Events,EventDetail,Providers,Packs,Incidents,Timeline,Flightcases}.jsx`
- `/app/frontend/src/components/{Layout,SearchSelect}.jsx`
