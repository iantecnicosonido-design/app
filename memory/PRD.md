# Stock Eventos - PRD

## Original Problem Statement
App en español para controlar el stock de material de empresa de eventos (Edison Bryan). Categorías: audio, video, luces, estructuras, cables. Calendario de eventos, bloqueo de material por evento, exportación a PDF al cerrar, ficha del evento (alquiler simple o bolo, fechas, horarios, ubicación, cliente, ref), opción de añadir material de alquiler externo, vehículos propios + alquilados, gestión de flightcases (cableado), incidencias con archivos, y autenticación con 3 roles.

## Roles & Permisos
| Rol | Inventario/Packs/Flightcases/Vehículos/Proveedores | Eventos (ficha) | Eventos (material) | Cerrar evento | Exportar PDF | Incidencias | Usuarios |
|---|---|---|---|---|---|---|---|
| **Productor** | ✅ Todo | ✅ Crea/edita/borra | ✅ | ✅ | ✅ | ✅ Todo | ✅ Crea/edita |
| **Almacén** | ✅ Todo | ❌ Solo ver | ✅ Modifica | ✅ | ✅ | ✅ Todo | ❌ |
| **Técnico** | ❌ | 👁 Solo asignados | ❌ | ❌ | ✅ Solo PDF | ✅ Solo crear | ❌ |

## Architecture
- Backend: FastAPI + Motor (MongoDB async) + reportlab + bcrypt + PyJWT.
- Frontend: React 19 + Tailwind + shadcn/ui + sonner + react-router-dom.
- Auth: JWT en httpOnly cookie + Bearer header fallback (localStorage). Productor admin sembrado al iniciar.
- Datos clave:
  - `users`: {id, email, password_hash, name, role, active}
  - `categories`, `materials`, `units`, `events` (+ assigned_technicians[]), `flightcases`, `vehicles`, `packs`, `incidents`, `incident_logs`, `password_reset_tokens`, `providers`.

## Implementation
- ✅ Inventario seed (308 ítems / 1491 unidades)
- ✅ CRUD materiales/unidades/subítems/categorías/packs/incidencias/proveedores
- ✅ Eventos bolo/alquiler con ventana precisa
- ✅ Bloqueo unit-level + edición fina de unidades por material
- ✅ Categoría dinámica "Cables" (sin unit refs ni subitems)
- ✅ Flightcases CRUD + distribución de cableado, PDF agrupa por flightcase
- ✅ Vehículos CRUD + asignación a eventos (propio/alquiler) + incidencias de vehículos
- ✅ Historial de incidencias con filtros (material/unidad/vehículo/tipo), URLs compartibles
- ✅ Badge de incidencias por material en inventario, por vehículo en vehículos
- ✅ Autenticación JWT + bcrypt + 3 roles (Productor/Almacén/Técnico)
- ✅ Gestión de usuarios desde UI (productor)
- ✅ Asignación de técnicos a eventos; técnicos solo ven sus eventos
- ✅ Reset password vía token (Resend email pendiente — token se loggea por ahora)
- ✅ Hoja de Preparación de Almacén — página dedicada `/eventos/:id/preparacion` (Feb 2026)
  - Layout tipo PDF, agrupado por categoría
  - Cables agrupados por flightcase
  - Checkboxes "marcar todas" a nivel material y a nivel flightcase
  - Sustitución cruzada de material (buscador global de almacén, no solo misma referencia)
  - Botón "Preparar" en cabecera de evento; lock/unlock por Almacén; estado read-only para resto de roles
  - Botón "Marcar todo" (marca todas las unidades como preparadas de golpe) y "Imprimir hoja" (PDF dedicado con casillas vacías para tachar a mano)
  - Material de alquiler externo también se puede marcar como preparado (checkbox + cuenta en X/Y)
  - Nuevo endpoint `GET /events/{eid}/export-prep` genera el PDF de preparación con bloque de firma
- ✅ Dashboard simplificado para rol Almacén (Feb 2026): solo Eventos preparados / Pendientes de preparar / Incidencias abiertas + calendario + accesos rápidos. Listado X/Y por evento con enlace directo a la hoja de preparación. Nuevos campos `prep_ready` y `prep_pending` en `/api/stats`
- ✅ Notas privadas Productor → Técnico por evento (Feb 2026)
  - Modal de asignación de técnicos rediseñado: checkbox + radio "Responsable" + textarea de nota privada por técnico
  - Nota incluida en el email de asignación
  - Visible al técnico en su vista del evento (solo lectura)
  - Endpoint dedicado `POST /events/{eid}/technicians` con `{assigned_technicians, responsible_technician_id, tech_notes}`
- ✅ Teléfono opcional en cuentas de usuario (Feb 2026): campo `phone` en User; visible en lista de usuarios y en chips de técnicos asignados
- ✅ Tareas independientes en calendario (Feb 2026): nuevo modelo `Task` (transporte / trabajo en nave / visita / otro) con fecha/hora, ubicación, notas, técnicos asignados, evento asociado opcional, archivos adjuntos. Visibles en el calendario de Eventos en chips morados. Productor crea/edita; técnico solo ve las suyas
- ✅ Apartado Gastos en bolos (Feb 2026): solo accesible para Productor y Técnico Responsable del evento. Cabecera con datos fiscales EDISON RENT SL · B60800301 y mensaje rojo "RECUERDE SOLICITAR FACTURA". Importe manual + adjuntos (archivo o cámara móvil con `capture="environment"`). Total agregado
- ✅ Técnico Responsable: el productor marca a uno de entre los asignados; mostrado con badge dorado ⭐ en la lista de técnicos del evento; única persona técnica con permiso para añadir gastos
- ✅ Entrega y Devolución de alquileres simples (Feb 2026):
  - **Entrega**: modal con fianza opcional + importe, DNI anverso/reverso (solo visible Almacén/Productor), aviso legal con checkbox obligatorio, método de pago (efectivo/tarjeta/transferencia), email cliente opcional, firma del cliente (canvas `react-signature-canvas`). Genera PDF dedicado con bloque legal completo + firma; envía por email si hay address; guarda en evento
  - **Devolución**: modal 2-step: firma del cliente conforme devuelve, luego revisión item-por-item (OK / NO OK / FALTA). NO OK y FALTA marcan unidad como averiada automáticamente y abren incidencia con texto "Devolución alquiler '[nombre]': dañado/faltante". Genera PDF acta de devolución con resumen + ambas firmas
  - Panel en el evento muestra estado (Pendiente/Entregado/Devuelto) con descarga directa de PDFs entrega/devolución/DNI
  - Endpoints: `POST /events/{eid}/delivery`, `POST /events/{eid}/return`, `GET /file-by-id/{fid}`
- ✅ Tests automatizados pasados (24/24 backend, 7/7 frontend)

## Backlog
### P1
- Integrar Resend para envío real de email (reset password + notificaciones técnicos/clientes)

### P2
- Logo personalizable en PDF
- Importar/exportar inventario CSV
- Histórico de movimientos por unidad (eventos, no solo incidencias)
- DialogDescription/aria-describedby para silenciar warnings de a11y
- Reducir ACCESS_MINUTES y usar refresh-token rotation

## Key Files
- `/app/backend/server.py`, `/app/backend/auth.py`, `/app/backend/seed_inventory.json`
- `/app/frontend/src/App.js`, `/app/frontend/src/lib/{api,auth}.js`
- `/app/frontend/src/pages/{Dashboard,Inventory,Events,EventDetail,EventPrepare,Providers,Packs,Incidents,Timeline,Flightcases,Vehicles,Users,Login,ResetPassword}.jsx`
- `/app/frontend/src/components/{Layout,SearchSelect}.jsx`
