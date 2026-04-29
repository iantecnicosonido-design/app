# Stock Eventos - PRD

## Original Problem Statement
App en español para controlar el stock de material de empresa de eventos. Categorías: audio, video, luces, estructuras (precargadas desde PDFs Edison Bryan). Calendario de eventos, bloqueo de material por evento, exportación a PDF al cerrar, ficha del evento (alquiler simple o bolo, fecha montaje, fecha acto, horarios, ubicación, nº referencia bolo, nombre cliente), opción de añadir material de alquiler externo discriminando empresa proveedora.

## User Choices
- Sin login (acceso libre, app interna)
- Inventario precargado desde PDFs (262 referencias)
- PDF generado en servidor (reportlab)
- Bloqueo resta del stock disponible
- Lista de empresas proveedoras gestionable

## Architecture
- Backend: FastAPI + Motor (MongoDB async) + reportlab para PDF. Todos los endpoints bajo `/api`.
- Frontend: React 19 + Tailwind + shadcn/ui + sonner + react-router-dom. Tipografía Outfit + JetBrains Mono. Tema cream/zinc con acento ámbar.
- Datos: Material {id, category, name, quantity, blocked}, Event {id, name, type, client_name, reference, location, setup_date, event_date, end_date, schedule, notes, status, materials[], rentals[]}, Provider {id, name, contact, phone, email, notes}.

## Implementation (29-Apr-2026)
- ✅ Seed automático de inventario (262 ítems desde `seed_inventory.json`) en startup si la colección está vacía
- ✅ CRUD de materiales con búsqueda y filtro por categoría
- ✅ CRUD de eventos con tipo alquiler/bolo y todos los campos de la ficha
- ✅ Bloqueo/desbloqueo de material por evento con control de stock disponible (delta logic)
- ✅ Material de alquiler externo por evento, vinculado a proveedor
- ✅ CRUD de proveedores
- ✅ Cerrar/reabrir evento, eliminación devuelve stock al inventario
- ✅ Exportación PDF estilizada (info, material por categoría, alquileres)
- ✅ Vista calendario de eventos (shadcn calendar multi-select)
- ✅ Dashboard con stats (total, por categoría, bloqueados, próximos eventos)
- ✅ Testing: 6/6 pytest backend + Playwright UI flows al 100%

## Backlog
### P1
- Validación en backend: rechazar `quantity<0` antes del cálculo de delta para mensajes más claros
- DELETE /api/providers/{id}: devolver 404 si no existe y limpiar referencias en rentals
- Soporte de roles/usuarios (si se quiere protección)
- Logo personalizado en el PDF

### P2
- Importar/exportar inventario en CSV
- Histórico de movimientos por material
- Vista mensual del calendario con eventos clicables
- Notificaciones (email/WhatsApp) al cerrar evento con PDF adjunto
- Sub-categorías o etiquetas (DJ, micrófono, conector, etc.)
- Multi-empresa / multi-almacén

## Key Files
- `/app/backend/server.py` - FastAPI app
- `/app/backend/seed_inventory.json` - 262 ítems iniciales
- `/app/frontend/src/App.js` - rutas
- `/app/frontend/src/pages/{Dashboard,Inventory,Events,EventDetail,Providers}.jsx`
- `/app/frontend/src/components/Layout.jsx` - sidebar + outlet
- `/app/frontend/src/lib/api.js` - axios instance
