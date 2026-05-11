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
- ✅ Entrega + Devolución + Comprobación de alquileres simples (Feb 2026, refactor 3-pasos):
  - **Entrega**: modal con fianza opcional + importe, DNI anverso/reverso (con captura desde cámara móvil, solo visible internamente), aviso legal completo con casilla obligatoria, método de pago (Efectivo/Tarjeta/Transferencia), email cliente opcional, firma cliente. Genera PDF "RECIBO DE ENTREGA · ALQUILER" con bloque legal + firma; email al cliente si tiene address
  - **Devolución** (paso intermedio para cliente): firma cliente conforme Edison Rent recibe el material + marcar cada item como **DEVUELTO** o **FALTA**. Items FALTA → unidad averiada + incidencia auto "faltante". Genera PDF "ACTA DE RECEPCIÓN · ALQUILER" con la frase legal "Edison Rent SL declara haber recibido el siguiente material, a la espera de la comprobación de su estado". Se envía por email al cliente automáticamente
  - **Comprobación** (paso final interno): solo accesible tras devolución. Almacén/Productor marca cada item devuelto como **OK** o **NO OK**. NO OK → unidad averiada + incidencia auto "dañado", con posibilidad de adjuntar archivo/foto desde cámara móvil que queda guardada en la incidencia. Items que ya eran FALTA aparecen en read-only. Genera PDF interno "ACTA DE COMPROBACIÓN · ALQUILER" con resumen OK/NO OK/FALTA
  - Panel en evento muestra 4 estados (Pendiente entrega / Entregado / Pendiente comprobación / Comprobado) con PDFs descargables de cada paso + DNI
- ✅ Tests automatizados pasados (24/24 backend, 7/7 frontend)
- ✅ **Migración email Resend → Brevo (Feb 2026)**: `emailer.py` reescrito para usar Brevo API v3 vía httpx async. Mantiene misma interfaz `send_email(to, subject, html, text, attachments)`, por lo que todos los flujos siguen funcionando (asignación técnicos, reset password, bienvenida, entrega/devolución/comprobación con PDF adjunto). Variables: `BREVO_API_KEY`, `SENDER_EMAIL`, `SENDER_NAME`. Probado en producción con adjunto PDF ✅
- ✅ **Favicon 32x32 (Feb 2026)**: generado desde el logo (icono circular "E"). `favicon.ico` multi-size, `favicon-32x32.png`, `apple-touch-icon.png` (180x180 iOS).
- ✅ **Nuevo rol `taller` + cuentas internas protegidas (Feb 2026)**:
  - Nuevo rol `taller` añadido a `ROLES`. Solo ve la sección Incidencias (resto del menú oculto, redirección automática)
  - Solo el rol `taller` puede resolver incidencias (`/incidents/{id}/resolve` y `/vehicle-incidents/{id}/resolve`). Productor y Almacén ya no pueden marcar como solucionada
  - Campo `protected: bool` en modelo User. Las cuentas protegidas no se pueden eliminar ni desactivar; sí cambiar contraseña por el productor
  - Cuentas internas sembradas en startup (sin email real):
    - `Taller` / `Taller` (rol taller, protected=true)
    - `Almacén` / `Almacén` (rol almacen, protected=true) — segundo almacén además del de email almacen@test.com
  - Login normaliza usuario y contraseña (lowercase + strip de acentos) para tolerar "Almacen"/"Almacén"/"almacen" indistintamente
  - Email obligatorio sigue siendo requerido para crear nuevos usuarios desde la UI; las cuentas internas no se crean desde UI
- ✅ **Cola de trabajo Taller con urgencia (Feb 2026)**:
  - Campos nuevos en units y vehicles: `urgent: bool` e `incident_opened_at: str`
  - Nuevos endpoints (solo productor): `POST /incidents/{unit_id}/urgent` y `POST /vehicle-incidents/{vid}/urgent` con `{urgent: bool}`
  - `create_incident` setea `incident_opened_at=now` y `urgent=false`
  - `resolve_incident` hace `$unset` de ambos campos
  - `list_incidents` ordena: urgentes primero, luego por `incident_opened_at` ascendente (más antiguas arriba). Backfill automático para legacy: usa fecha del último report log si no hay `incident_opened_at`
  - UI Incidents.jsx: badge "🔥 URGENTE" rojo + borde izquierdo rojo + fondo rosado en tarjetas urgentes. Columna "hace Xh/Xd" tiempo abierta. Botón ⚠️ (solo productor) para toggle urgencia. Para rol taller, título cambia a "Cola de trabajo · Taller"
- ✅ **Auto-retirada de material averiado + sistema de notificaciones (Feb 2026)**:
  - `create_incident` ya NO rechaza unidades/vehículos asignados a eventos abiertos. En su lugar:
    1. Retira automáticamente la unidad de todos los `events` abiertos donde aparezca en `materials[].units[]`
    2. Para vehículos, retira de `events.vehicles[]` (solo los `type=owned`)
    3. Crea una `Notification` por cada evento afectado dirigida a TODOS los productores activos
  - Nueva colección `notifications` + modelo `Notification` (id, user_id, type, title, message, link, read, created_at)
  - Endpoints CRUD: `GET /notifications` (con unread count), `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `DELETE /notifications/{id}`
  - Frontend: nuevo componente `NotificationBell` en sidebar (Layout.jsx) con badge rojo de no leídas, dropdown con últimas 30 notifs (poll cada 30s), click marca leída y navega al link del evento. Helpers backend: `_notify(user_id, ...)`, `_notify_productores(...)`, `_remove_unit_from_open_events(...)`, `_remove_vehicle_from_open_events(...)`
- ✅ **Estado "Listo para preparar" controlado por productor (Feb 2026)**:
  - Nuevos campos en Event: `material_ready_for_prep: bool`, `material_ready_at`, `material_ready_by`, `material_ready_by_name`
  - Nuevos endpoints (solo productor): `POST /events/{eid}/mark-ready-for-prep`, `POST /events/{eid}/unmark-ready-for-prep`
  - `_assert_event_modifiable(eid, user)` ahora acepta `user` opcional; si `material_ready_for_prep=True` y user no es almacen → 423
  - Todos los endpoints de edición de material/vehículos/alquileres del evento pasan `user`
  - Todos los endpoints de preparación (`prep/check-unit`, `prep/check-batch`, `prep/substitute`, `prep/remove-unit`, `prep/lock`) llaman a `_assert_ready_for_prep(ev)` → 423 si productor no ha marcado listo
  - Al marcar listo: notifica a todos los almacén activos con link `/eventos/{eid}/preparacion`
  - **Al bloquear preparación (`prep/lock`)**: notifica a todos los productores activos ("Almacén ha terminado la preparación, listo para salir nave")
  - Productor puede desmarcar SOLO si almacén aún no ha bloqueado (`prep_status="pendiente"`)
  - Frontend: botón verde "🔒 Listo para preparar" (productor) → cambia a outline "🔓 Desbloquear edición" cuando ya está marcado. Botón "Preparar" deshabilitado para almacén hasta que esté marcado (tooltip "Esperando productor"). Banner amarillo con estado claro y texto explicativo según rol.

- ✅ **Aceptación de bolo por técnico + notif productor (Feb 2026)**:
  - Nuevos campos en Event: `tech_status: Dict[str,str]` (`pendiente|aceptado|rechazado`) y `tech_decline_reason: Dict[str,str]`
  - `assign_technicians` ahora setea `pendiente` a los nuevos asignados y limpia técnicos quitados
  - Nuevos endpoints (rol tecnico): `POST /events/{eid}/accept`, `POST /events/{eid}/decline` (con `reason` opcional)
  - Cada acción notifica a todos los productores activos con título "X ha aceptado/rechazado <evento>" (incluye motivo en caso de rechazo)
  - Email de asignación actualizado: título "Te han asignado un evento — pendiente de aceptar", CTA "Ver y aceptar bolo" apunta a `/eventos/{id}`
  - Frontend: banner amarillo gigante en EventDetail para el técnico asignado con status pendiente/rechazado con botones "✓ Aceptar bolo" / "X Rechazar". Badge PENDIENTE/ACEPTADO/RECHAZADO en cada chip de técnico (visible para productor)
- ✅ **Duplicar material de evento anterior con resolución de conflictos (Feb 2026)**:
  - Botón "Copiar de otro evento" en sección Material (visible siempre para roles con permiso de editar material)
  - Endpoint `GET /events/with-materials?q=&exclude=&limit=` busca cualquier evento con material por nombre/cliente/referencia (case+accent insensitive)
  - Endpoint legacy `GET /events/similar-by-name` se mantiene
  - `GET /events/{eid}/duplicate-preview?source=eid_src` calcula disponibilidad real ahora para cada material del origen
  - `POST /events/{eid}/duplicate-from` aplica resoluciones (`copy|substitute|skip`)
  - Modal 2 pasos: 1) **buscador en vivo** + lista de eventos con material disponible, 2) tabla con materiales del origen y su disponibilidad. Para cada uno: copiar / sustituir / eliminar
  - Items sin stock aparecen en rojo con badge "Faltan N" y se auto-marcan como "sustituir" por defecto
  - Componente: `/app/frontend/src/components/DuplicateMaterialDialog.jsx`

- ✅ **Técnico autónomo + facturas (Feb 2026)**:
  - Nuevo campo `User.autonomo: bool` (productor lo activa en Usuarios → editar). Badge "AUTÓNOMO" naranja en la lista.
  - Nuevos campos Event: `tech_invoices: List`, `rental_invoices: List`.
  - Endpoints:
    - `POST /events/{eid}/tech-invoices` (rol tecnico + autonomo + asignado al evento) — body `{file, amount?, notes?}`. Notifica productores.
    - `DELETE /events/{eid}/tech-invoices/{iid}` — productor o el técnico dueño.
    - `POST /events/{eid}/rental-invoices` (productor) — body `{file, amount?, provider_name?, rental_id?, notes?}`.
    - `DELETE /events/{eid}/rental-invoices/{iid}` (productor).
  - `_scrub_invoices()` filtra el contenido de los arrays según rol al devolver eventos:
    - productor: ve todo
    - tecnico: ve solo sus propias `tech_invoices`, sin `rental_invoices`
    - almacen/taller: no ve ninguna factura
  - Frontend: nuevo componente `InvoicesSection` montado en EventDetail. Para tec autónomo asignado: form de upload + lista de su factura. Para productor: ambas secciones completas con uploader, importe €, proveedor (en alquileres), notas, abrir y eliminar.

- ✅ **Contactos y documentación en bolos (Feb 2026)**:
  - Solo en eventos `type=bolo` (rechazado 400 para alquileres).
  - **Contactos**: `Event.contacts: List` con `{id, name, role, phone, email}`. Endpoints POST/PUT/DELETE `/events/{eid}/contacts[/{cid}]` (productor). UI: lista de cards en EventDetail con phone clickable, email clickable, editar y eliminar.
  - **Documentación**: `Event.documents: List` con `{id, category, file, notes, uploaded_by, uploaded_at}`. Categorías: `hoja_ruta | rider | contrarider | implantacion | otros`. Endpoints POST `/events/{eid}/documents` (productor) y DELETE `/events/{eid}/documents/{did}` (productor). UI: lista agrupada por categoría con botón "Abrir" y eliminar. Visible para todos los roles con acceso al evento.
  - Componente: `/app/frontend/src/components/EventBoloSections.jsx` exporta `ContactsSection` y `DocumentsSection`.

- ✅ **Presupuesto + Factura del evento + Rol/Funciones por técnico (Feb 2026)**:
  - Nuevos campos Event: `event_budget`, `event_invoice` (PDF único cada uno).
  - Endpoints `POST/DELETE /events/{eid}/budget` y `/invoice` (productor; bolo o alquiler).
  - `_scrub_invoices()` extendido: ahora oculta también `event_budget`, `event_invoice`, `tech_notes` y `tech_functions` a no-productores. Técnicos solo ven su propia entrada en `tech_notes` y `tech_functions`.
  - Nuevos campos Event: `tech_roles: Dict[str,str]` (visible a productor + propio tec + otros tecs del bolo) y `tech_functions: Dict[str,str]` (privada, productor + propio tec).
  - `TechAssignmentRequest` extendido: acepta `tech_roles` y `tech_functions`.
  - Frontend:
    - `EventFinanceDocs.jsx`: 2 cards (Presupuesto verde, Factura marrón) en cabecera del evento. Solo PDF. Badge "SOLO PRODUCTOR". Subir, reemplazar, abrir y eliminar.
    - Diálogo de asignar técnicos extendido: por cada técnico marcado muestra inputs Rol (corto), Funciones (largo) y Nota privada.
    - Chip del técnico muestra badge con su rol (visible a todos).
    - Para el técnico logueado: banner verde "Mi rol y funciones" y banner amarillo "Nota privada del productor" si existen.

## Backlog
### P1
- Favicon (convertir `/app/frontend/public/logo.png` a 32x32 favicon.ico)
- Verificar `ianedisonrent@gmail.com` como sender en Brevo para evitar carpeta SPAM

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
