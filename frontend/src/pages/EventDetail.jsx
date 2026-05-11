import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API, formatDate } from "../lib/api";
import { ArrowLeft, FileDown, Lock, Unlock, Plus, Trash2, Save, Search, Package, Pencil, Box, Truck, UserPlus, Users as UsersIcon, PackageCheck, PackageOpen } from "lucide-react";
import { useAuth, can } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { DeliveryDialog } from "../components/DeliveryDialog";
import { ReturnDialog } from "../components/ReturnDialog";
import { CheckDialog } from "../components/CheckDialog";
import SearchSelect from "../components/SearchSelect";
import { toast } from "sonner";

const fmtDt = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return s; }
};

export default function EventDetail() {
  const { user } = useAuth();
  const canEditFicha = can(user, "event_edit_ficha");
  const _canMaterial = can(user, "event_material");
  const canClose = can(user, "event_close");
  const { id } = useParams();
  // canMaterial is dynamic — disabled when prep is locked (only almacén can unlock)
  // Defined below after we have `ev`.
  const navigate = useNavigate();
  const [ev, setEv] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [providers, setProviders] = useState([]);
  const [packs, setPacks] = useState([]);
  const [allUnits, setAllUnits] = useState([]);
  const [categories, setCategories] = useState([]);
  const [flightcases, setFlightcases] = useState([]);
  const [matOpen, setMatOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [pickedMat, setPickedMat] = useState(null);
  const [blockQty, setBlockQty] = useState(1);
  const [availability, setAvailability] = useState(null);
  const [rentForm, setRentForm] = useState({ name: "", quantity: 1, provider_id: "", provider_name: "", notes: "" });
  const [edit, setEdit] = useState(null);
  const [editBlockedOpen, setEditBlockedOpen] = useState(false);
  const [editBlockedMat, setEditBlockedMat] = useState(null);
  const [editBlockedAvail, setEditBlockedAvail] = useState(null);
  const [editBlockedSel, setEditBlockedSel] = useState(new Set());
  const [editBlockedQty, setEditBlockedQty] = useState(1);
  const [distOpen, setDistOpen] = useState(false);
  const [distMat, setDistMat] = useState(null);
  const [distMap, setDistMap] = useState({}); // {fc_name: qty}
  const [vehOpen, setVehOpen] = useState(false);
  const [vehAvail, setVehAvail] = useState([]);
  const [vehForm, setVehForm] = useState({ type: "owned", vehicle_id: "", name: "", plate: "", notes: "" });
  const [technicians, setTechnicians] = useState([]);
  const [techOpen, setTechOpen] = useState(false);
  const [techSel, setTechSel] = useState([]);
  const [techNotes, setTechNotes] = useState({}); // {tid: note}
  const [techResponsible, setTechResponsible] = useState(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);

  const load = async () => {
    const r = await api.get(`/events/${id}`);
    setEv(r.data);
    setEdit(null);
  };
  useEffect(() => {
    load();
    api.get("/materials").then((r) => setMaterials(r.data));
    api.get("/providers").then((r) => setProviders(r.data));
    api.get("/packs").then((r) => setPacks(r.data));
    api.get("/units").then((r) => setAllUnits(r.data));
    api.get("/categories").then((r) => setCategories(r.data));
    api.get("/flightcases").then((r) => setFlightcases(r.data));
    api.get("/technicians").then((r) => setTechnicians(r.data)).catch(() => {});
    /* eslint-disable-next-line */
  }, [id]);

  useEffect(() => {
    if (pickedMat) {
      api.get(`/events/${id}/availability`, { params: { material_id: pickedMat.id } }).then((r) => setAvailability(r.data));
    } else setAvailability(null);
    // eslint-disable-next-line
  }, [pickedMat]);

  if (!ev) return <div style={{ padding: 40, color: "var(--ink-mute)" }}>Cargando...</div>;

  const isClosed = ev.status === "cerrado";
  const isBolo = (edit?.type ?? ev.type) === "bolo";
  const editing = edit ?? ev;

  const saveEdit = async () => {
    const fields = ["name","type","client_name","client_contact","reference","location","setup_date","event_date","end_date","schedule","notes",
      "warehouse_out_dt","return_dt","setup_start_dt","setup_end_dt","act_start_dt","act_end_dt","dismount_start_dt","dismount_end_dt"];
    const payload = {};
    fields.forEach((k) => { payload[k] = editing[k] ?? ""; });
    try {
      const r = await api.put(`/events/${id}`, payload);
      setEv(r.data); setEdit(null);
      toast.success("Evento actualizado");
    } catch { toast.error("Error al guardar"); }
  };

  const blockMaterial = async () => {
    if (!pickedMat) { toast.error("Elige un material"); return; }
    try {
      const r = await api.post(`/events/${id}/materials`, { material_id: pickedMat.id, quantity: blockQty });
      setEv(r.data);
      setMatOpen(false); setPickedMat(null); setSearchQ(""); setBlockQty(1);
      api.get("/materials").then((rr) => setMaterials(rr.data));
      toast.success("Material bloqueado");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const unblockMaterial = async (mid) => {
    try {
      const r = await api.delete(`/events/${id}/materials/${mid}`);
      setEv(r.data);
      api.get("/materials").then((rr) => setMaterials(rr.data));
      toast.success("Desbloqueado");
    } catch { toast.error("Error"); }
  };

  const startEditBlocked = async (m) => {
    setEditBlockedMat(m);
    const cat = categories.find((c) => c.key === m.category);
    const hasUnitRefs = cat?.has_unit_refs !== false;
    if (hasUnitRefs) {
      try {
        const r = await api.get(`/events/${id}/availability`, { params: { material_id: m.material_id } });
        setEditBlockedAvail(r.data);
      } catch { setEditBlockedAvail({ units: [], available_count: 0 }); }
      setEditBlockedSel(new Set((m.units || []).map((u) => u.unit_id)));
    } else {
      setEditBlockedQty(m.units?.length || 1);
    }
    setEditBlockedOpen(true);
  };

  const saveEditBlocked = async () => {
    if (!editBlockedMat) return;
    const cat = categories.find((c) => c.key === editBlockedMat.category);
    const hasUnitRefs = cat?.has_unit_refs !== false;
    try {
      if (hasUnitRefs) {
        const ids = Array.from(editBlockedSel);
        if (ids.length === 0) {
          await api.delete(`/events/${id}/materials/${editBlockedMat.material_id}`);
        } else {
          await api.post(`/events/${id}/materials`, { material_id: editBlockedMat.material_id, unit_ids: ids });
        }
      } else {
        if (editBlockedQty < 1) {
          await api.delete(`/events/${id}/materials/${editBlockedMat.material_id}`);
        } else {
          await api.post(`/events/${id}/materials`, { material_id: editBlockedMat.material_id, quantity: editBlockedQty });
        }
      }
      const r = await api.get(`/events/${id}`);
      setEv(r.data);
      api.get("/materials").then((rr) => setMaterials(rr.data));
      setEditBlockedOpen(false);
      setEditBlockedMat(null);
      toast.success("Actualizado");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const toggleEditUnit = (uid) => {
    const next = new Set(editBlockedSel);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    setEditBlockedSel(next);
  };

  const startDistribute = (m) => {
    setDistMat(m);
    const counts = {};
    (m.units || []).forEach((u) => {
      const fc = u.flightcase || "";
      counts[fc] = (counts[fc] || 0) + 1;
    });
    setDistMap(counts);
    setDistOpen(true);
  };

  const distTotal = () => Object.values(distMap).reduce((a, b) => a + (parseInt(b) || 0), 0);

  const updateDist = (fc, qty) => {
    const next = { ...distMap };
    const v = Math.max(0, parseInt(qty || 0));
    if (v === 0) delete next[fc]; else next[fc] = v;
    setDistMap(next);
  };

  const addFcToDist = (fcName) => {
    if (!fcName) return;
    if (distMap[fcName] !== undefined) return;
    setDistMap({ ...distMap, [fcName]: 0 });
  };

  const saveDistribution = async () => {
    if (!distMat) return;
    const totalUnits = (distMat.units || []).length;
    if (distTotal() !== totalUnits) {
      toast.error(`La suma debe ser ${totalUnits} (actual ${distTotal()})`);
      return;
    }
    try {
      await api.put(`/events/${id}/cable-distribution`, {
        material_id: distMat.material_id,
        distribution: distMap,
      });
      const r = await api.get(`/events/${id}`);
      setEv(r.data);
      setDistOpen(false);
      setDistMat(null);
      toast.success("Distribución actualizada");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const openAddVehicle = async () => {
    try {
      const r = await api.get(`/events/${id}/vehicle-availability`);
      setVehAvail(r.data);
    } catch { setVehAvail([]); }
    setVehForm({ type: "owned", vehicle_id: "", name: "", plate: "", notes: "" });
    setVehOpen(true);
  };

  const submitVehicle = async () => {
    if (vehForm.type === "owned" && !vehForm.vehicle_id) { toast.error("Elige un vehículo"); return; }
    if (vehForm.type === "rental" && !vehForm.name.trim()) { toast.error("Nombre del vehículo de alquiler obligatorio"); return; }
    try {
      const r = await api.post(`/events/${id}/vehicles`, vehForm);
      setEv(r.data);
      setVehOpen(false);
      toast.success("Vehículo añadido");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const removeVehicle = async (vid) => {
    try {
      const r = await api.delete(`/events/${id}/vehicles/${vid}`);
      setEv(r.data);
      toast.success("Vehículo retirado");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const toggleTech = (tid) => {
    if (techSel.includes(tid)) {
      setTechSel(techSel.filter((x) => x !== tid));
      if (techResponsible === tid) setTechResponsible(null);
    } else {
      setTechSel([...techSel, tid]);
    }
  };

  const saveTechs = async () => {
    try {
      const r = await api.post(`/events/${id}/technicians`, {
        assigned_technicians: techSel,
        responsible_technician_id: techResponsible,
        tech_notes: techNotes,
      });
      setEv(r.data);
      setTechOpen(false);
      toast.success("Técnicos actualizados");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  // ---------- Preparación state (read-only here, full editor in /preparacion page) ----------
  const isAlmacen = user?.role === "almacen";
  const isPrepLocked = ev?.prep_status === "preparado";
  const canMaterial = _canMaterial && !isPrepLocked;

  // Flatten all blocked units + rentals for the prep summary (X/Y)
  const prepRows = [
    ...((ev?.materials || []).flatMap((m) => (m.units || []).map((u) => ({ unit_id: u.unit_id })))),
    ...((ev?.rentals || []).map((r) => ({ unit_id: r.id }))),
  ];
  const prepChecks = new Set(ev?.prep_checks || []);
  const totalUnits = prepRows.length;
  const checkedCount = prepRows.filter((r) => prepChecks.has(r.unit_id)).length;

  const applyPack = async (pid) => {
    try {
      const r = await api.post(`/events/${id}/apply-pack/${pid}`);
      const fail = r.data.results.filter((x) => !x.ok);
      setEv(r.data.event);
      api.get("/materials").then((rr) => setMaterials(rr.data));
      if (fail.length === 0) toast.success("Pack aplicado");
      else toast.error(`Aplicado parcial. ${fail.length} ítem(s) fallaron.`);
      setPackOpen(false);
    } catch (e) { toast.error("Error aplicando pack"); }
  };

  const addRental = async () => {
    if (!rentForm.name.trim()) { toast.error("Nombre obligatorio"); return; }
    try {
      const r = await api.post(`/events/${id}/rentals`, rentForm);
      setEv(r.data); setRentOpen(false);
      setRentForm({ name: "", quantity: 1, provider_id: "", provider_name: "", notes: "" });
      toast.success("Alquiler añadido");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const removeRental = async (rid) => { try { const r = await api.delete(`/events/${id}/rentals/${rid}`); setEv(r.data); } catch { toast.error("Error"); } };

  const closeEvent = async () => {
    if (!window.confirm("¿Cerrar este evento?")) return;
    const r = await api.post(`/events/${id}/close`); setEv(r.data); toast.success("Cerrado");
  };
  const reopenEvent = async () => { const r = await api.post(`/events/${id}/reopen`); setEv(r.data); toast.success("Reabierto"); };
  const deleteEvent = async () => {
    if (!window.confirm("¿Eliminar este evento? Se devolverá el stock.")) return;
    await api.delete(`/events/${id}`); toast.success("Eliminado"); navigate("/eventos");
  };
  const exportPDF = () => window.open(`${API}/events/${id}/export`, "_blank");

  const grouped = {};
  categories.forEach((c) => { grouped[c.key] = []; });
  ev.materials.forEach((m) => {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  });

  const filteredMaterials = materials.filter((m) =>
    !searchQ || m.name.toLowerCase().includes(searchQ.toLowerCase()) || (m.reference || "").toLowerCase().includes(searchQ.toLowerCase())
  ).slice(0, 30);

  return (
    <div data-testid="event-detail-page">
      <Link to="/eventos" style={{ color: "var(--ink-mute)", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Volver a eventos
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <h2 className="page-title" style={{ margin: 0 }}>{ev.name}</h2>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, padding: "3px 10px", borderRadius: 999, background: ev.type === "bolo" ? "#fef3c7" : "#e0e7ff", color: ev.type === "bolo" ? "#92400e" : "#3730a3", textTransform: "uppercase", letterSpacing: "0.08em" }}>{ev.type}</span>
            <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: isClosed ? "#fee2e2" : "#dcfce7", color: isClosed ? "#991b1b" : "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>{ev.status}</span>
          </div>
          <p className="page-sub" style={{ margin: 0 }}>{ev.client_name || "Sin cliente"} {ev.reference && `· Ref. ${ev.reference}`}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Entrega / Devolución (alquileres simples) */}
          {ev.type === "alquiler" && (user?.role === "almacen" || user?.role === "productor") && (
            <>
              {!ev.delivery?.delivered_at && !isClosed && (
                <Button onClick={() => setDeliveryOpen(true)} style={{ background: "#3730a3" }} data-testid="delivery-btn">
                  <PackageOpen size={14} /> Entrega
                </Button>
              )}
              {ev.delivery?.delivered_at && !ev.return_info?.returned_at && !isClosed && (
                <Button onClick={() => setReturnOpen(true)} style={{ background: "#166534" }} data-testid="return-btn">
                  <PackageCheck size={14} /> Devolución
                </Button>
              )}
            </>
          )}
          {(isAlmacen || canEditFicha) && totalUnits > 0 && (
            <Button
              onClick={() => navigate(`/eventos/${id}/preparacion`)}
              style={{ background: isPrepLocked ? "var(--good)" : "#3730a3" }}
              data-testid="open-prepare-btn"
            >
              <Package size={16} /> {isPrepLocked ? "Preparado" : "Preparar"}
            </Button>
          )}
          <Button variant="outline" onClick={exportPDF} data-testid="export-pdf-btn"><FileDown size={16} /> PDF</Button>
          {canClose && (!isClosed ? <Button onClick={closeEvent} style={{ background: "#1c1917" }}><Lock size={16} /> Cerrar</Button> : <Button onClick={reopenEvent} variant="outline"><Unlock size={16} /> Reabrir</Button>)}
          {canEditFicha && <Button variant="ghost" onClick={deleteEvent}><Trash2 size={16} color="#b91c1c" /></Button>}
        </div>
      </div>

      {/* Preparation status banner (read-only here; full editor in /preparacion) */}
      {totalUnits > 0 && (
        <div
          className="card-paper"
          style={{
            background: isPrepLocked ? "#dcfce7" : "#f5f5f4",
            border: `1px solid ${isPrepLocked ? "#86efac" : "var(--line)"}`,
            padding: 14, marginBottom: 18,
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}
          data-testid="prep-status-banner"
        >
          <div>
            <div style={{ fontWeight: 700, color: isPrepLocked ? "#166534" : "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
              {isPrepLocked ? <Lock size={16} /> : <Package size={16} />}
              {isPrepLocked
                ? `Material preparado y bloqueado por ${ev.prep_locked_by_name || "Almacén"}`
                : `Preparación pendiente · ${checkedCount}/${totalUnits} unidades preparadas`}
            </div>
            {isPrepLocked && (
              <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>
                {ev.prep_locked_at ? new Date(ev.prep_locked_at).toLocaleString("es-ES") : ""} · Nadie puede modificar material/vehículos hasta que Almacén lo desbloquee.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card-paper" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Ficha del evento</h3>
          {canEditFicha && !isClosed && !edit && <Button variant="ghost" size="sm" onClick={() => setEdit({ ...ev })}>Editar</Button>}
          {edit && <div style={{ display: "flex", gap: 8 }}><Button variant="outline" size="sm" onClick={() => setEdit(null)}>Cancelar</Button><Button size="sm" onClick={saveEdit} style={{ background: "var(--accent)" }}><Save size={14} /> Guardar</Button></div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <Info label="Cliente" value={editing.client_name} edit={!!edit} onChange={(v) => setEdit({ ...edit, client_name: v })} />
          {!isBolo && <Info label="Contacto" value={editing.client_contact} edit={!!edit} onChange={(v) => setEdit({ ...edit, client_contact: v })} />}
          <Info label="Referencia" value={editing.reference} edit={!!edit} onChange={(v) => setEdit({ ...edit, reference: v })} />
          <Info label="Ubicación" value={editing.location} edit={!!edit} onChange={(v) => setEdit({ ...edit, location: v })} />
          <Info label="Tipo" value={editing.type} edit={!!edit} onChange={(v) => setEdit({ ...edit, type: v })} select={[{v:"alquiler",l:"Alquiler simple"},{v:"bolo",l:"Bolo"}]} display={editing.type === "bolo" ? "Bolo" : "Alquiler simple"} />
          <Info label="Fecha acto" value={editing.event_date} edit={!!edit} onChange={(v) => setEdit({ ...edit, event_date: v })} type="date" display={formatDate(editing.event_date)} />
          <Info label="Horarios" value={editing.schedule} edit={!!edit} onChange={(v) => setEdit({ ...edit, schedule: v })} />
        </div>
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--line)" }}>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>{isBolo ? "Cronograma del bolo · ventana de bloqueo" : "Salida y retorno · ventana de bloqueo"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            {isBolo ? (
              <>
                <Info label="Salida nave" value={editing.warehouse_out_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, warehouse_out_dt: v })} type="datetime-local" display={fmtDt(editing.warehouse_out_dt)} />
                <Info label="Inicio montaje" value={editing.setup_start_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, setup_start_dt: v })} type="datetime-local" display={fmtDt(editing.setup_start_dt)} />
                <Info label="Fin montaje" value={editing.setup_end_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, setup_end_dt: v })} type="datetime-local" display={fmtDt(editing.setup_end_dt)} />
                <Info label="Inicio acto" value={editing.act_start_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, act_start_dt: v })} type="datetime-local" display={fmtDt(editing.act_start_dt)} />
                <Info label="Fin acto" value={editing.act_end_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, act_end_dt: v })} type="datetime-local" display={fmtDt(editing.act_end_dt)} />
                <Info label="Inicio desmontaje" value={editing.dismount_start_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, dismount_start_dt: v })} type="datetime-local" display={fmtDt(editing.dismount_start_dt)} />
                <Info label="Fin desmontaje" value={editing.dismount_end_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, dismount_end_dt: v })} type="datetime-local" display={fmtDt(editing.dismount_end_dt)} />
              </>
            ) : (
              <>
                <Info label="Salida nave" value={editing.warehouse_out_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, warehouse_out_dt: v })} type="datetime-local" display={fmtDt(editing.warehouse_out_dt)} />
                <Info label="Retorno" value={editing.return_dt} edit={!!edit} onChange={(v) => setEdit({ ...edit, return_dt: v })} type="datetime-local" display={fmtDt(editing.return_dt)} />
              </>
            )}
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <Info label="Notas" full value={editing.notes} edit={!!edit} onChange={(v) => setEdit({ ...edit, notes: v })} multi />
        </div>
      </div>

      <div className="card-paper" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Material bloqueado del stock</h3>
          {canMaterial && !isClosed && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => setPackOpen(true)} variant="outline" size="sm" data-testid="apply-pack-btn"><Package size={14} /> Aplicar pack</Button>
              <Button onClick={() => setMatOpen(true)} style={{ background: "var(--accent)" }} size="sm" data-testid="block-material-btn"><Plus size={14} /> Bloquear material</Button>
            </div>
          )}
        </div>
        {ev.materials.length === 0 ? <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Aún no se ha bloqueado material.</p> : (
          <>
            {categories.map((c) => (grouped[c.key] || []).length > 0 && (
              <div key={c.key} style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 8 }}><span className={`cat-pill cat-${c.key}`}>{c.label}</span></div>
                {grouped[c.key].map((m) => (
                  <div key={m.material_id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 4px" }}>
                    <div className="row-hover" style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px 130px", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{m.reference || "—"}</span>
                      <div style={{ fontWeight: 500 }}>{m.name}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>x{m.units?.length || 0}</div>
                      <div style={{ textAlign: "right", display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        {canMaterial && !isClosed && c.has_unit_refs === false && <Button size="icon" variant="ghost" onClick={() => startDistribute(m)} title="Distribuir en flightcases"><Box size={14} /></Button>}
                        {canMaterial && !isClosed && <Button size="icon" variant="ghost" onClick={() => startEditBlocked(m)} title="Editar unidades"><Pencil size={14} /></Button>}
                        {canMaterial && !isClosed && <Button size="icon" variant="ghost" onClick={() => unblockMaterial(m.material_id)} title="Quitar todo"><Trash2 size={14} /></Button>}
                      </div>
                    </div>
                    {c.has_unit_refs !== false && (
                      <div style={{ paddingLeft: 110, marginTop: 6 }}>
                        {(m.units || []).map((u) => (
                          <div key={u.unit_id} style={{ fontSize: 12, color: "var(--ink-soft)", padding: "2px 0" }}>
                            • <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)" }}>{u.reference}</span>
                            {(u.subitems || []).map((s, i) => {
                              let displayName = s.name;
                              const ref = s.unit_reference || "";
                              if (s.type === "unit" && (!s.name || s.name.startsWith("("))) {
                                const subU = allUnits.find((x) => x.id === s.unit_id);
                                const subM = subU ? materials.find((mm) => mm.id === subU.material_id) : null;
                                if (subM) displayName = subM.name;
                              }
                              return (
                                <div key={i} style={{ marginLeft: 16, fontStyle: "italic", fontSize: 11, color: "var(--ink-mute)" }}>
                                  ↳ {s.type === "unit"
                                    ? <><span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)", fontStyle: "normal" }}>({ref})</span> [{displayName}]</>
                                    : displayName}
                                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontStyle: "normal" }}> x{s.qty}</span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                    {c.has_unit_refs === false && (() => {
                      const counts = {};
                      (m.units || []).forEach((u) => { const fc = u.flightcase || ""; counts[fc] = (counts[fc] || 0) + 1; });
                      const keys = Object.keys(counts);
                      if (keys.length <= 1 && keys[0] === "") return null;
                      return (
                        <div style={{ paddingLeft: 110, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {keys.sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map((fc) => (
                            <span key={fc} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: fc ? "#e0e7ff" : "#f5f5f4", color: fc ? "#3730a3" : "#78716c", fontWeight: 500 }}>
                              {fc || "Sin flightcase"} · x{counts[fc]}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Preparación section moved to dedicated page /eventos/:id/preparacion */}

      <div className="card-paper" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><UsersIcon size={18} /> Técnicos asignados</h3>
          {canEditFicha && !isClosed && (
            <Button size="sm" onClick={() => { setTechSel(ev.assigned_technicians || []); setTechNotes(ev.tech_notes || {}); setTechResponsible(ev.responsible_technician_id || null); setTechOpen(true); }} style={{ background: "var(--accent)" }} data-testid="assign-tech-btn"><UserPlus size={14} /> Asignar</Button>
          )}
        </div>
        {(ev.assigned_technicians || []).length === 0 ? (
          <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Sin técnicos asignados.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(ev.assigned_technicians || []).map((tid) => {
              const t = technicians.find((x) => x.id === tid);
              const isResp = ev.responsible_technician_id === tid;
              return (
                <span key={tid} style={{ padding: "6px 12px", borderRadius: 999, background: isResp ? "#fef3c7" : "#dcfce7", color: isResp ? "#92400e" : "#166534", fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }} title={isResp ? "Responsable del evento" : ""}>
                  {isResp && <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.06em" }}>★</span>}
                  {t ? (t.name || t.email) : tid}
                  {t?.phone && <span style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>· {t.phone}</span>}
                </span>
              );
            })}
          </div>
        )}
        {/* Private note shown only to the logged-in technician (if exists) */}
        {user?.role === "tecnico" && (ev.tech_notes || {})[user.id] && (
          <div style={{ marginTop: 12, padding: 12, borderLeft: "3px solid var(--accent)", background: "#fffbeb", borderRadius: 6 }} data-testid="my-tech-note">
            <div style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.1em", color: "#92400e", marginBottom: 4 }}>Nota privada del productor</div>
            <div style={{ fontSize: 13, color: "#78350f", whiteSpace: "pre-wrap" }}>{ev.tech_notes[user.id]}</div>
          </div>
        )}
      </div>

      <div className="card-paper" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><Truck size={18} /> Vehículos</h3>
          {canMaterial && !isClosed && <Button onClick={openAddVehicle} style={{ background: "var(--accent)" }} size="sm" data-testid="add-vehicle-event-btn"><Plus size={14} /> Añadir vehículo</Button>}
        </div>
        {(ev.vehicles || []).length === 0 ? (
          <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Sin vehículos asignados.</p>
        ) : (
          (ev.vehicles || []).map((vh) => (
            <div key={vh.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "120px 1fr 100px 60px", padding: "10px 4px", borderBottom: "1px solid var(--line)", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>{vh.plate || "—"}</span>
              <div>
                <div style={{ fontWeight: 500 }}>{vh.name || "(sin nombre)"}</div>
                {vh.notes && <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{vh.notes}</div>}
              </div>
              <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", padding: "3px 10px", borderRadius: 999, background: vh.type === "owned" ? "#dcfce7" : "#e0e7ff", color: vh.type === "owned" ? "#166534" : "#3730a3", textAlign: "center" }}>
                {vh.type === "owned" ? "PROPIO" : "ALQUILER"}
              </span>
              <div style={{ textAlign: "right" }}>{canMaterial && !isClosed && <Button size="icon" variant="ghost" onClick={() => removeVehicle(vh.id)}><Trash2 size={14} /></Button>}</div>
            </div>
          ))
        )}
      </div>

      <div className="card-paper">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Material de alquiler externo</h3>
          {canMaterial && !isClosed && <Button onClick={() => setRentOpen(true)} style={{ background: "var(--accent)" }} size="sm"><Plus size={14} /> Añadir alquiler</Button>}
        </div>
        {ev.rentals.length === 0 ? <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Sin material de alquiler externo.</p> : ev.rentals.map((r) => (
          <div key={r.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px 60px", padding: "10px 4px", borderBottom: "1px solid var(--line)", alignItems: "center", gap: 8 }}>
            <div><div style={{ fontWeight: 500 }}>{r.name}</div>{r.notes && <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{r.notes}</div>}</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{r.provider_name || "—"}</div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>x{r.quantity}</div>
            <div style={{ textAlign: "right" }}>{canMaterial && !isClosed && <Button size="icon" variant="ghost" onClick={() => removeRental(r.id)}><Trash2 size={14} /></Button>}</div>
          </div>
        ))}
      </div>

      {/* Expenses (bolo only) */}
      {ev.type === "bolo" && (user?.role === "productor" || (user?.role === "tecnico" && ev.responsible_technician_id === user.id)) && (
        <ExpensesSection eventId={id} canEdit={!isClosed} userRole={user.role} userId={user.id} />
      )}

      {/* Delivery/Return panel (alquileres only) */}
      {ev.type === "alquiler" && (user?.role === "almacen" || user?.role === "productor") && (
        <DeliveryReturnPanel ev={ev} />
      )}

      <DeliveryDialog open={deliveryOpen} onClose={() => setDeliveryOpen(false)} eventId={id} onSaved={load} />
      <ReturnDialog open={returnOpen} onClose={() => setReturnOpen(false)} event={ev} onSaved={load} />
      <CheckDialog open={checkOpen} onClose={() => setCheckOpen(false)} event={ev} onSaved={load} />

      {/* Block material with search */}
      <Dialog open={matOpen} onOpenChange={(o) => { setMatOpen(o); if (!o) { setPickedMat(null); setSearchQ(""); } }}>
        <DialogContent style={{ maxWidth: 640 }} data-testid="block-material-dialog">
          <DialogHeader><DialogTitle>Bloquear material del stock</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "var(--ink-mute)" }} />
              <Input data-testid="block-search" placeholder="Busca por nombre o referencia..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} style={{ paddingLeft: 36 }} autoFocus />
            </div>
            {!pickedMat ? (
              <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                {filteredMaterials.map((m) => (
                  <button key={m.id} onClick={() => setPickedMat(m)} className="row-hover" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 14px", borderBottom: "1px solid var(--line)", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", borderTop: "none", borderLeft: "none", borderRight: "none" }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)", fontWeight: 600, marginRight: 8 }}>{m.reference}</span>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{m.category} · {m.quantity} unidades</div>
                  </button>
                ))}
                {filteredMaterials.length === 0 && <p style={{ padding: 20, color: "var(--ink-mute)", textAlign: "center" }}>Sin resultados</p>}
              </div>
            ) : (
              <div style={{ padding: 14, border: "1.5px solid var(--accent)", borderRadius: 8, background: "#fffbeb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{pickedMat.reference}</div>
                    <div style={{ fontWeight: 600 }}>{pickedMat.name}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setPickedMat(null)}>cambiar</Button>
                </div>
                {availability && (
                  <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: "0 0 10px" }}>
                    {availability.available_count} disponibles en la ventana del evento
                    {availability.units.filter((u) => !u.available).length > 0 && (
                      <span> · {availability.units.filter((u) => !u.available).length} no disponibles</span>
                    )}
                  </p>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8, alignItems: "center" }}>
                  <Input type="number" min={1} max={availability?.available_count || 99} value={blockQty} onChange={(e) => setBlockQty(parseInt(e.target.value || "1"))} data-testid="block-quantity" />
                  <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>unidades a bloquear (asignación automática)</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatOpen(false)}>Cancelar</Button>
            <Button onClick={blockMaterial} disabled={!pickedMat} style={{ background: "var(--accent)" }} data-testid="confirm-block-btn">Bloquear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply pack */}
      <Dialog open={packOpen} onOpenChange={setPackOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aplicar pack</DialogTitle></DialogHeader>
          {packs.length === 0 ? (
            <p style={{ color: "var(--ink-mute)" }}>Aún no hay packs. Crea uno en <Link to="/packs" className="subtle-link">Packs</Link>.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {packs.map((p) => (
                <button key={p.id} onClick={() => applyPack(p.id)} className="row-hover" style={{ background: "none", textAlign: "left", padding: 14, border: "1px solid var(--line)", borderRadius: 8, cursor: "pointer" }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{p.items.length} ítems</div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add vehicle */}
      <Dialog open={vehOpen} onOpenChange={setVehOpen}>
        <DialogContent style={{ maxWidth: 560 }} data-testid="add-vehicle-dialog">
          <DialogHeader><DialogTitle>Añadir vehículo</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Tipo">
              <div style={{ display: "flex", gap: 6 }}>
                <Button size="sm" variant={vehForm.type === "owned" ? "default" : "outline"} onClick={() => setVehForm({ ...vehForm, type: "owned", name: "", plate: "" })} style={vehForm.type === "owned" ? { background: "var(--accent)" } : {}} data-testid="veh-type-owned">Propio de la empresa</Button>
                <Button size="sm" variant={vehForm.type === "rental" ? "default" : "outline"} onClick={() => setVehForm({ ...vehForm, type: "rental", vehicle_id: "" })} style={vehForm.type === "rental" ? { background: "var(--accent)" } : {}} data-testid="veh-type-rental">Alquilado</Button>
              </div>
            </Lbl>
            {vehForm.type === "owned" ? (
              <Lbl label="Vehículo">
                <div style={{ display: "grid", gap: 6 }}>
                  {vehAvail.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>No hay vehículos. <Link to="/vehiculos" className="subtle-link">Crea uno</Link>.</p>}
                  {vehAvail.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => v.available && setVehForm({ ...vehForm, vehicle_id: v.id })}
                      disabled={!v.available}
                      data-testid={`veh-pick-${v.plate}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr 130px",
                        gap: 8,
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: vehForm.vehicle_id === v.id ? "2px solid var(--accent)" : "1px solid var(--line)",
                        background: vehForm.vehicle_id === v.id ? "#fffbeb" : "#fff",
                        cursor: v.available ? "pointer" : "not-allowed",
                        opacity: v.available ? 1 : 0.5,
                        textAlign: "left",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{v.plate}</span>
                      <span style={{ fontWeight: 500 }}>{v.name}</span>
                      <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", color: v.available ? "var(--good)" : "var(--bad)", textAlign: "right" }}>{v.available ? "DISPONIBLE" : v.reason}</span>
                    </button>
                  ))}
                </div>
              </Lbl>
            ) : (
              <>
                <Lbl label="Nombre / empresa de alquiler">
                  <Input value={vehForm.name} onChange={(e) => setVehForm({ ...vehForm, name: e.target.value })} placeholder="Ej: Furgo Sixt" data-testid="veh-rental-name" />
                </Lbl>
                <Lbl label="Matrícula (opcional)">
                  <Input value={vehForm.plate} onChange={(e) => setVehForm({ ...vehForm, plate: e.target.value.toUpperCase() })} data-testid="veh-rental-plate" />
                </Lbl>
              </>
            )}
            <Lbl label="Notas"><Textarea rows={2} value={vehForm.notes} onChange={(e) => setVehForm({ ...vehForm, notes: e.target.value })} /></Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVehOpen(false)}>Cancelar</Button>
            <Button onClick={submitVehicle} style={{ background: "var(--accent)" }} data-testid="confirm-add-vehicle-btn">Añadir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Substitute dialog moved to /eventos/:id/preparacion */}

      {/* Assign technicians */}
      <Dialog open={techOpen} onOpenChange={setTechOpen}>
        <DialogContent style={{ maxWidth: 680 }} data-testid="assign-tech-dialog">
          <DialogHeader><DialogTitle>Asignar técnicos al evento</DialogTitle></DialogHeader>
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 6 }}>
            Selecciona técnicos, marca uno como <b>responsable</b> y escribe una nota privada para cada uno (se enviará en el email de asignación).
          </p>
          <div style={{ display: "grid", gap: 8, maxHeight: 480, overflowY: "auto", padding: 4 }}>
            {technicians.length === 0 ? (
              <p style={{ color: "var(--ink-mute)", fontSize: 13 }}>No hay técnicos. Crea usuarios en <b>Usuarios</b>.</p>
            ) : technicians.map((t) => {
              const checked = techSel.includes(t.id);
              const isResp = techResponsible === t.id;
              return (
                <div key={t.id} style={{ padding: 10, borderRadius: 8, border: `1px solid ${isResp ? "var(--accent)" : "var(--line)"}`, background: checked ? (isResp ? "#fff7ed" : "#fffbeb") : "#fff" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 110px 110px", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleTech(t.id)} data-testid={`tech-${t.email}`} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{t.name || t.email}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                        {t.email}{t.phone ? ` · ${t.phone}` : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", background: t.role === "productor" ? "#fef3c7" : "#dcfce7", color: t.role === "productor" ? "#92400e" : "#166534", textAlign: "center" }}>{t.role}</span>
                    <label style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6, color: checked ? "var(--ink)" : "var(--ink-mute)", cursor: checked ? "pointer" : "not-allowed" }} title="Marcar como responsable del evento">
                      <input
                        type="radio"
                        name="tech-responsible"
                        checked={isResp}
                        disabled={!checked}
                        onChange={() => setTechResponsible(t.id)}
                        data-testid={`tech-resp-${t.email}`}
                      />
                      Responsable
                    </label>
                  </div>
                  {checked && (
                    <Textarea
                      placeholder="Nota privada para este técnico (opcional). Se incluye en el email de asignación."
                      value={techNotes[t.id] || ""}
                      onChange={(e) => setTechNotes({ ...techNotes, [t.id]: e.target.value })}
                      data-testid={`tech-note-${t.email}`}
                      style={{ marginTop: 8, minHeight: 60, fontSize: 13 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {techResponsible && !techSel.includes(techResponsible) && (
            <p style={{ fontSize: 12, color: "var(--bad)" }}>El responsable debe estar entre los asignados.</p>
          )}
          <DialogFooter>
            {techResponsible && (
              <Button variant="ghost" size="sm" onClick={() => setTechResponsible(null)}>Quitar responsable</Button>
            )}
            <Button variant="outline" onClick={() => setTechOpen(false)}>Cancelar</Button>
            <Button onClick={saveTechs} style={{ background: "var(--accent)" }} data-testid="save-tech-btn">Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rental */}
      <Dialog open={rentOpen} onOpenChange={setRentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Material de alquiler externo</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Material"><Input value={rentForm.name} onChange={(e) => setRentForm({ ...rentForm, name: e.target.value })} /></Lbl>
            <Lbl label="Cantidad"><Input type="number" min={1} value={rentForm.quantity} onChange={(e) => setRentForm({ ...rentForm, quantity: parseInt(e.target.value || "1") })} /></Lbl>
            <Lbl label="Empresa proveedora">
              <SearchSelect
                placeholder="Buscar proveedor..."
                value={rentForm.provider_id}
                onChange={(v) => setRentForm({ ...rentForm, provider_id: v })}
                allowClear
                options={providers.map((p) => ({ value: p.id, label: p.name, sub: p.contact || p.phone || "", keywords: (p.contact || "") + " " + (p.phone || "") }))}
              />
            </Lbl>
            <Lbl label="Notas"><Textarea rows={2} value={rentForm.notes} onChange={(e) => setRentForm({ ...rentForm, notes: e.target.value })} /></Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRentOpen(false)}>Cancelar</Button>
            <Button onClick={addRental} style={{ background: "var(--accent)" }}>Añadir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Edit blocked material */}
      <Dialog open={editBlockedOpen} onOpenChange={setEditBlockedOpen}>
        <DialogContent style={{ maxWidth: 600, maxHeight: "92vh", overflowY: "auto" }} data-testid="edit-blocked-dialog">
          <DialogHeader>
            <DialogTitle>Editar material bloqueado</DialogTitle>
          </DialogHeader>
          {editBlockedMat && (() => {
            const cat = categories.find((c) => c.key === editBlockedMat.category);
            const hasUnitRefs = cat?.has_unit_refs !== false;
            return (
              <div>
                <div style={{ padding: 12, background: "#fffbeb", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 14 }}>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{editBlockedMat.reference}</div>
                  <div style={{ fontWeight: 600 }}>{editBlockedMat.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{cat?.label || editBlockedMat.category}</div>
                </div>
                {hasUnitRefs ? (
                  <div>
                    <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 10 }}>
                      Marca o desmarca unidades. {editBlockedSel.size} seleccionada(s).
                    </p>
                    <div style={{ maxHeight: 380, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                      {(editBlockedAvail?.units || []).map((u) => {
                        const checked = editBlockedSel.has(u.id);
                        const blockedHere = (editBlockedMat.units || []).some((x) => x.unit_id === u.id);
                        const disabled = !u.available && !blockedHere;
                        return (
                          <label key={u.id} style={{ display: "grid", gridTemplateColumns: "20px 110px 1fr 90px", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line)", alignItems: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, background: checked ? "#fef3c7" : "transparent" }}>
                            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleEditUnit(u.id)} data-testid={`edit-unit-${u.reference}`} />
                            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{u.reference}</span>
                            <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                              {(u.subitems || []).length > 0 && `incluye ${u.subitems.length} subítem(s)`}
                            </span>
                            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", color: u.available ? "var(--good)" : "var(--bad)", textAlign: "right" }}>
                              {u.available ? (blockedHere ? "actual" : "disp.") : (u.reason || "no disp.")}
                            </span>
                          </label>
                        );
                      })}
                      {(!editBlockedAvail?.units || editBlockedAvail.units.length === 0) && (
                        <div style={{ padding: 14, color: "var(--ink-mute)", fontSize: 13 }}>Sin unidades.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 10 }}>
                      Esta categoría no usa numeración por unidad. Ajusta la cantidad bloqueada.
                    </p>
                    <Lbl label="Cantidad">
                      <Input type="number" min={0} value={editBlockedQty} onChange={(e) => setEditBlockedQty(parseInt(e.target.value || "0"))} data-testid="edit-blocked-qty" />
                    </Lbl>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBlockedOpen(false)}>Cancelar</Button>
            <Button onClick={saveEditBlocked} style={{ background: "var(--accent)" }} data-testid="save-edit-blocked-btn"><Save size={14} /> Guardar cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Distribute cables across flightcases */}
      <Dialog open={distOpen} onOpenChange={setDistOpen}>
        <DialogContent style={{ maxWidth: 560 }} data-testid="dist-dialog">
          <DialogHeader><DialogTitle>Distribuir en flightcases</DialogTitle></DialogHeader>
          {distMat && (
            <div>
              <div style={{ padding: 12, background: "#fffbeb", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 14 }}>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{distMat.reference}</div>
                <div style={{ fontWeight: 600 }}>{distMat.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>
                  Total bloqueado: {(distMat.units || []).length} · Distribuido: {distTotal()}
                  {distTotal() !== (distMat.units || []).length && <span style={{ color: "var(--bad)", fontWeight: 600 }}> · debe sumar {(distMat.units || []).length}</span>}
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                {Object.keys(distMap).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map((fc) => (
                  <div key={fc} style={{ display: "grid", gridTemplateColumns: "1fr 80px 36px", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 500, fontSize: 13 }}>{fc || <span style={{ color: "var(--ink-mute)", fontStyle: "italic" }}>Sin flightcase</span>}</span>
                    <Input type="number" min={0} value={distMap[fc]} onChange={(e) => updateDist(fc, e.target.value)} data-testid={`dist-qty-${fc || "none"}`} />
                    {fc !== "" && <Button size="icon" variant="ghost" onClick={() => updateDist(fc, 0)}><Trash2 size={14} /></Button>}
                    {fc === "" && <span />}
                  </div>
                ))}
              </div>
              <div style={{ paddingTop: 12, borderTop: "1px dashed var(--line)" }}>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 8 }}>Añadir flightcase</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {flightcases.filter((f) => distMap[f.name] === undefined).map((f) => (
                    <Button key={f.id} size="sm" variant="outline" onClick={() => addFcToDist(f.name)}>+ {f.name}</Button>
                  ))}
                  {flightcases.filter((f) => distMap[f.name] === undefined).length === 0 && (
                    <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                      No quedan flightcases en la biblioteca. <Link to="/flightcases" className="subtle-link">Crear nuevos</Link>.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDistOpen(false)}>Cancelar</Button>
            <Button onClick={saveDistribution} style={{ background: "var(--accent)" }} data-testid="save-dist-btn"><Save size={14} /> Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value, edit, onChange, type, multi, full, select, display }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>{label}</div>
      {!edit ? <div style={{ fontSize: 14, fontWeight: multi ? 400 : 500, color: "var(--ink)", whiteSpace: "pre-wrap" }}>{display ?? (value || "—")}</div>
        : select ? (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{select.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
          </Select>
        ) : multi ? <Textarea rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} />
        : <Input type={type || "text"} value={value || ""} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function Lbl({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// =================== ExpensesSection ===================
function ExpensesSection({ eventId, canEdit, userRole, userId }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", amount: "", files: [] });
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.get(`/events/${eventId}/expenses`);
      setItems(r.data || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eventId]);

  const total = items.reduce((acc, x) => acc + Number(x.amount || 0), 0);

  const onPickFiles = async (filesList) => {
    if (!filesList || filesList.length === 0) return;
    setUploading(true);
    const added = [];
    try {
      for (const f of filesList) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        added.push({ file_id: r.data.id, name: r.data.name, content_type: r.data.content_type });
      }
      setForm((s) => ({ ...s, files: [...(s.files || []), ...added] }));
    } catch (e) { toast.error("Error subiendo archivo"); }
    finally { setUploading(false); }
  };

  const submit = async () => {
    if (!form.description.trim()) { toast.error("Descripción obligatoria"); return; }
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt < 0) { toast.error("Importe inválido"); return; }
    try {
      await api.post(`/events/${eventId}/expenses`, {
        description: form.description.trim(),
        amount: amt,
        currency: "EUR",
        files: form.files || [],
      });
      toast.success("Gasto añadido");
      setOpen(false);
      setForm({ description: "", amount: "", files: [] });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const removeOne = async (xid) => {
    if (!window.confirm("¿Eliminar este gasto?")) return;
    try { await api.delete(`/events/${eventId}/expenses/${xid}`); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div className="card-paper" style={{ marginTop: 18, border: "1px solid var(--accent)" }} data-testid="expenses-section">
      {/* Fiscal header */}
      <div style={{ padding: 14, marginBottom: 14, background: "#fafaf9", border: "1px solid var(--line)", borderRadius: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
          <div style={{ fontSize: 12, lineHeight: 1.55 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>EDISON RENT SL</div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--ink-mute)" }}>B60800301</div>
            <div>Carrer Lluis Millet, 64</div>
            <div>08950, Esplugues de Llobregat, Barcelona</div>
          </div>
          <div style={{ padding: "8px 14px", background: "#fee2e2", color: "#991b1b", border: "1.5px solid #fca5a5", borderRadius: 6, fontWeight: 700, fontSize: 13, letterSpacing: "0.04em", textAlign: "right" }} data-testid="expenses-fiscal-warning">
            ⚠ RECUERDE SOLICITAR FACTURA
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Gastos</h3>
        {canEdit && (
          <Button onClick={() => setOpen(true)} style={{ background: "var(--accent)" }} size="sm" data-testid="add-expense-btn"><Plus size={14} /> Añadir gasto</Button>
        )}
      </div>

      {loading ? (
        <p style={{ color: "var(--ink-mute)", fontSize: 13 }}>Cargando…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--ink-mute)", fontSize: 13 }}>Sin gastos registrados.</p>
      ) : (
        <>
          {items.map((x) => (
            <div key={x.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 110px 160px 60px", gap: 8, padding: "10px 4px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{x.description}</div>
                {(x.files || []).length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {x.files.map((f) => (
                      <a key={f.file_id} href={`${API}/files/edison/uploads/${f.file_id}.${(f.name.split(".").pop() || "bin")}`}
                         target="_blank" rel="noreferrer"
                         style={{ fontSize: 11, padding: "2px 8px", background: "#fef3c7", color: "#92400e", borderRadius: 4, textDecoration: "none", fontFamily: "JetBrains Mono, monospace" }}>
                        {f.name || "archivo"}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700, fontSize: 14 }}>{Number(x.amount).toFixed(2)} {x.currency}</div>
              <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                {x.created_by_name}<br/>
                <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{new Date(x.created_at).toLocaleString("es-ES")}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                {canEdit && (userRole === "productor" || x.created_by === userId) && (
                  <Button size="icon" variant="ghost" onClick={() => removeOne(x.id)}><Trash2 size={14} /></Button>
                )}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 4px", fontWeight: 700, fontSize: 15 }}>
            Total: {total.toFixed(2)} EUR
          </div>
        </>
      )}

      {/* Add expense modal */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm({ description: "", amount: "", files: [] }); }}>
        <DialogContent data-testid="expense-dialog" style={{ maxWidth: 540 }}>
          <DialogHeader><DialogTitle>Nuevo gasto</DialogTitle></DialogHeader>
          <div style={{ padding: 10, background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            RECUERDE SOLICITAR FACTURA · EDISON RENT SL · B60800301
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Descripción">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej. Gasolina, peaje, comida del equipo…" data-testid="expense-desc" />
            </Lbl>
            <Lbl label="Importe (EUR)">
              <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" data-testid="expense-amount" />
            </Lbl>
            <Lbl label="Factura / ticket / fotos">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px dashed var(--line)", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                  <Plus size={14} /> Subir archivo
                  <input type="file" multiple style={{ display: "none" }} onChange={(e) => onPickFiles(e.target.files)} data-testid="expense-file-input" />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px dashed var(--line)", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                  📷 Hacer foto
                  <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => onPickFiles(e.target.files)} data-testid="expense-camera-input" />
                </label>
                {uploading && <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>Subiendo…</span>}
              </div>
              {(form.files || []).length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {form.files.map((f, i) => (
                    <span key={f.file_id} style={{ fontSize: 11, padding: "4px 8px", background: "#dcfce7", color: "#166534", borderRadius: 4, fontFamily: "JetBrains Mono, monospace", display: "inline-flex", gap: 6 }}>
                      {f.name}
                      <button onClick={() => setForm({ ...form, files: form.files.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", cursor: "pointer", color: "#166534" }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-expense-btn">Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// =================== Delivery / Return Panel ===================
function DeliveryReturnPanel({ ev }) {
  const d = ev.delivery;
  const r = ev.return_info;
  const fmtDt = (s) => {
    if (!s) return "—";
    try { return new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }); }
    catch { return s; }
  };
  const fileUrl = (rec, kind) => {
    if (!rec) return null;
    // download URL: try by storage_path pattern (file_id + ext). We use the API /files/{path} for download.
    // For simplicity we use a redirect endpoint based on file_id with auth header — but img src can't pass headers.
    // Workaround: open file via the storage_path. We don't know the ext here; assume jpg/png/pdf works via content-type.
    // We'll just expose a tiny endpoint using the file id via /files/edison/uploads/{id}.<ext>. We don't have ext here.
    // So we use a generic fetch and create a blob URL on click.
    return null;
  };
  // eslint-disable-next-line no-unused-vars
  void fileUrl;

  const Pill = ({ color, bg, children, testId }) => (
    <span data-testid={testId} style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: bg, color, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "JetBrains Mono, monospace" }}>{children}</span>
  );

  const openFile = async (fileId) => {
    if (!fileId) return;
    try {
      const resp = await api.get(`/file-by-id/${fileId}`, { responseType: "blob" });
      const blob = new Blob([resp.data], { type: resp.headers["content-type"] });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch {
      toast.error("No se pudo abrir el archivo");
    }
  };

  return (
    <div className="card-paper" style={{ marginBottom: 18, border: "1px solid var(--line)" }} data-testid="delivery-return-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Entrega · Devolución · Comprobación</h3>
        <div style={{ display: "flex", gap: 6 }}>
          {!d && <Pill color="#78716c" bg="#f5f5f4" testId="status-pending">Pendiente de entrega</Pill>}
          {d && !r && <Pill color="#3730a3" bg="#e0e7ff" testId="status-delivered">Entregado</Pill>}
          {r && !ev.check_info && <Pill color="#1e3a8a" bg="#dbeafe" testId="status-returned">Pendiente comprobación</Pill>}
          {ev.check_info && <Pill color="#166534" bg="#dcfce7" testId="status-checked">Comprobado</Pill>}
        </div>
      </div>

      {d && (
        <div style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 8, background: "#fafaf9", marginBottom: r ? 10 : 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div><b style={{ color: "var(--ink-mute)" }}>Fecha entrega:</b><br/>{fmtDt(d.delivered_at)}</div>
            <div><b style={{ color: "var(--ink-mute)" }}>Pago:</b><br/>{(d.payment_method || "—").toUpperCase()}</div>
            <div><b style={{ color: "var(--ink-mute)" }}>Fianza:</b><br/>{d.has_deposit ? `${Number(d.deposit_amount || 0).toFixed(2)} EUR` : "—"}</div>
            {d.client_email && <div style={{ gridColumn: "1 / -1" }}><b style={{ color: "var(--ink-mute)" }}>Email cliente:</b> {d.client_email}</div>}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {d.doc_file_id && <Button size="sm" variant="outline" onClick={() => openFile(d.doc_file_id)} data-testid="open-delivery-pdf"><FileDown size={14} /> PDF entrega</Button>}
            {d.dni_front_file_id && <Button size="sm" variant="outline" onClick={() => openFile(d.dni_front_file_id)} data-testid="open-dni-front">DNI anverso</Button>}
            {d.dni_back_file_id && <Button size="sm" variant="outline" onClick={() => openFile(d.dni_back_file_id)} data-testid="open-dni-back">DNI reverso</Button>}
          </div>
        </div>
      )}

      {r && (
        <div style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 8, background: "#eff6ff", marginBottom: ev.check_info ? 10 : 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div><b style={{ color: "var(--ink-mute)" }}>Fecha devolución:</b><br/>{fmtDt(r.returned_at)}</div>
            <div><b style={{ color: "var(--ink-mute)" }}>Faltantes:</b><br/>{(r.items || []).filter((x) => x.status === "missing").length}</div>
            <div><b style={{ color: "var(--ink-mute)" }}>Items devueltos:</b><br/>{(r.items || []).filter((x) => x.status === "returned").length}</div>
          </div>
          <div style={{ marginTop: 10 }}>
            {r.doc_file_id && <Button size="sm" variant="outline" onClick={() => openFile(r.doc_file_id)} data-testid="open-return-pdf"><FileDown size={14} /> PDF devolución (cliente)</Button>}
          </div>
        </div>
      )}

      {ev.check_info && (
        <div style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 8, background: "#f0fdf4" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div><b style={{ color: "var(--ink-mute)" }}>Fecha comprobación:</b><br/>{fmtDt(ev.check_info.checked_at)}</div>
            <div><b style={{ color: "var(--ink-mute)" }}>Incidencias abiertas:</b><br/>{ev.check_info.incidents_opened || 0}</div>
            <div><b style={{ color: "var(--ink-mute)" }}>Items revisados:</b><br/>{(ev.check_info.items || []).length}</div>
          </div>
          <div style={{ marginTop: 10 }}>
            {ev.check_info.doc_file_id && <Button size="sm" variant="outline" onClick={() => openFile(ev.check_info.doc_file_id)} data-testid="open-check-pdf"><FileDown size={14} /> PDF comprobación (interno)</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

