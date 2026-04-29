import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API, CATEGORIES, formatDate } from "../lib/api";
import { ArrowLeft, FileDown, Lock, Unlock, Plus, Trash2, Save } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ev, setEv] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [providers, setProviders] = useState([]);
  const [matOpen, setMatOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const [matForm, setMatForm] = useState({ material_id: "", quantity: 1, category: "audio" });
  const [rentForm, setRentForm] = useState({ name: "", quantity: 1, provider_id: "", provider_name: "", notes: "" });
  const [edit, setEdit] = useState(null);

  const load = async () => {
    const r = await api.get(`/events/${id}`);
    setEv(r.data);
    setEdit(null);
  };
  useEffect(() => { load(); api.get("/materials").then((r) => setMaterials(r.data)); api.get("/providers").then((r) => setProviders(r.data)); /* eslint-disable-next-line */ }, [id]);

  const filteredMaterials = useMemo(
    () => materials.filter((m) => m.category === matForm.category),
    [materials, matForm.category]
  );

  if (!ev) return <div style={{ padding: 40, color: "var(--ink-mute)" }}>Cargando...</div>;

  const isClosed = ev.status === "cerrado";
  const editing = edit ?? ev;

  const saveEdit = async () => {
    const payload = {};
    ["name","type","client_name","reference","location","setup_date","event_date","end_date","schedule","notes"].forEach((k) => {
      payload[k] = editing[k] ?? "";
    });
    try {
      const r = await api.put(`/events/${id}`, payload);
      setEv(r.data); setEdit(null);
      toast.success("Evento actualizado");
    } catch (e) { toast.error("Error al guardar"); }
  };

  const blockMaterial = async () => {
    if (!matForm.material_id) { toast.error("Elige un material"); return; }
    try {
      const r = await api.post(`/events/${id}/materials`, { material_id: matForm.material_id, quantity: matForm.quantity });
      setEv(r.data); setMatOpen(false);
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
    } catch (e) { toast.error("Error"); }
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

  const removeRental = async (rid) => {
    try {
      const r = await api.delete(`/events/${id}/rentals/${rid}`);
      setEv(r.data);
    } catch (e) { toast.error("Error"); }
  };

  const closeEvent = async () => {
    if (!window.confirm("¿Cerrar este evento? El material seguirá bloqueado hasta que se elimine o reabra.")) return;
    const r = await api.post(`/events/${id}/close`);
    setEv(r.data); toast.success("Evento cerrado");
  };
  const reopenEvent = async () => {
    const r = await api.post(`/events/${id}/reopen`);
    setEv(r.data); toast.success("Evento reabierto");
  };

  const deleteEvent = async () => {
    if (!window.confirm("¿Eliminar este evento? Se devolverá el stock bloqueado.")) return;
    await api.delete(`/events/${id}`);
    toast.success("Evento eliminado");
    navigate("/eventos");
  };

  const exportPDF = () => {
    window.open(`${API}/events/${id}/export`, "_blank");
  };

  const grouped = { audio: [], video: [], luces: [], estructuras: [] };
  ev.materials.forEach((m) => grouped[m.category]?.push(m));

  return (
    <div data-testid="event-detail-page">
      <Link to="/eventos" style={{ color: "var(--ink-mute)", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Volver a eventos
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h2 className="page-title" style={{ margin: 0 }}>{ev.name}</h2>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, padding: "3px 10px", borderRadius: 999, background: ev.type === "bolo" ? "#fef3c7" : "#e0e7ff", color: ev.type === "bolo" ? "#92400e" : "#3730a3", textTransform: "uppercase", letterSpacing: "0.08em" }}>{ev.type}</span>
            <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: isClosed ? "#fee2e2" : "#dcfce7", color: isClosed ? "#991b1b" : "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>{ev.status}</span>
          </div>
          <p className="page-sub" style={{ margin: 0 }}>{ev.client_name || "Sin cliente"} {ev.reference && `· Ref. ${ev.reference}`}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="outline" onClick={exportPDF} data-testid="export-pdf-btn"><FileDown size={16} /> PDF</Button>
          {!isClosed ? (
            <Button onClick={closeEvent} style={{ background: "#1c1917" }} data-testid="close-event-btn"><Lock size={16} /> Cerrar evento</Button>
          ) : (
            <Button onClick={reopenEvent} variant="outline" data-testid="reopen-event-btn"><Unlock size={16} /> Reabrir</Button>
          )}
          <Button variant="ghost" onClick={deleteEvent} data-testid="delete-event-btn"><Trash2 size={16} color="#b91c1c" /></Button>
        </div>
      </div>

      {/* Ficha */}
      <div className="card-paper" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Ficha del evento</h3>
          {!isClosed && !edit && <Button variant="ghost" size="sm" onClick={() => setEdit({ ...ev })} data-testid="edit-event-btn">Editar</Button>}
          {edit && <div style={{ display: "flex", gap: 8 }}><Button variant="outline" size="sm" onClick={() => setEdit(null)}>Cancelar</Button><Button size="sm" onClick={saveEdit} style={{ background: "var(--accent)" }} data-testid="save-event-edit"><Save size={14} /> Guardar</Button></div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <Info label="Cliente" value={editing.client_name} edit={!!edit} onChange={(v) => setEdit({ ...edit, client_name: v })} />
          <Info label="Referencia" value={editing.reference} edit={!!edit} onChange={(v) => setEdit({ ...edit, reference: v })} />
          <Info label="Ubicación" value={editing.location} edit={!!edit} onChange={(v) => setEdit({ ...edit, location: v })} />
          <Info label="Tipo" value={editing.type} edit={!!edit} onChange={(v) => setEdit({ ...edit, type: v })} select={[{v:"alquiler",l:"Alquiler simple"},{v:"bolo",l:"Bolo"}]} display={editing.type === "bolo" ? "Bolo" : "Alquiler simple"} />
          <Info label="Montaje" value={editing.setup_date} edit={!!edit} onChange={(v) => setEdit({ ...edit, setup_date: v })} type="date" display={formatDate(editing.setup_date)} />
          <Info label="Fecha acto" value={editing.event_date} edit={!!edit} onChange={(v) => setEdit({ ...edit, event_date: v })} type="date" display={formatDate(editing.event_date)} />
          <Info label="Fin" value={editing.end_date} edit={!!edit} onChange={(v) => setEdit({ ...edit, end_date: v })} type="date" display={formatDate(editing.end_date)} />
          <Info label="Horarios" value={editing.schedule} edit={!!edit} onChange={(v) => setEdit({ ...edit, schedule: v })} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Info label="Notas" full value={editing.notes} edit={!!edit} onChange={(v) => setEdit({ ...edit, notes: v })} multi />
        </div>
      </div>

      {/* Material bloqueado */}
      <div className="card-paper" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Material bloqueado del stock</h3>
          {!isClosed && <Button onClick={() => setMatOpen(true)} style={{ background: "var(--accent)" }} size="sm" data-testid="block-material-btn"><Plus size={14} /> Bloquear material</Button>}
        </div>
        {ev.materials.length === 0 ? (
          <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Aún no se ha bloqueado material.</p>
        ) : (
          <>
            {CATEGORIES.map((c) => grouped[c.key].length > 0 && (
              <div key={c.key} style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 8 }}><span className={`cat-pill cat-${c.key}`}>{c.label}</span></div>
                {grouped[c.key].map((m) => (
                  <div key={m.material_id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px", padding: "10px 4px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                    <div>{m.name}</div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--ink-soft)" }}>x{m.quantity}</div>
                    <div style={{ textAlign: "right" }}>
                      {!isClosed && <Button size="icon" variant="ghost" onClick={() => unblockMaterial(m.material_id)} data-testid={`unblock-${m.material_id}`}><Trash2 size={14} /></Button>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Alquiler externo */}
      <div className="card-paper">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Material de alquiler externo</h3>
          {!isClosed && <Button onClick={() => setRentOpen(true)} style={{ background: "var(--accent)" }} size="sm" data-testid="add-rental-btn"><Plus size={14} /> Añadir alquiler</Button>}
        </div>
        {ev.rentals.length === 0 ? (
          <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Sin material de alquiler externo.</p>
        ) : (
          ev.rentals.map((r) => (
            <div key={r.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px 60px", padding: "10px 4px", borderBottom: "1px solid var(--line)", alignItems: "center", gap: 8 }}>
              <div><div style={{ fontWeight: 500 }}>{r.name}</div>{r.notes && <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{r.notes}</div>}</div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{r.provider_name || "—"}</div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>x{r.quantity}</div>
              <div style={{ textAlign: "right" }}>
                {!isClosed && <Button size="icon" variant="ghost" onClick={() => removeRental(r.id)}><Trash2 size={14} /></Button>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Block material dialog */}
      <Dialog open={matOpen} onOpenChange={setMatOpen}>
        <DialogContent data-testid="block-material-dialog">
          <DialogHeader><DialogTitle>Bloquear material del stock</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <FieldLabel label="Categoría">
              <Select value={matForm.category} onValueChange={(v) => setMatForm({ ...matForm, category: v, material_id: "" })}>
                <SelectTrigger data-testid="block-category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Material">
              <Select value={matForm.material_id} onValueChange={(v) => setMatForm({ ...matForm, material_id: v })}>
                <SelectTrigger data-testid="block-material-select"><SelectValue placeholder="Elige un material..." /></SelectTrigger>
                <SelectContent>
                  {filteredMaterials.map((m) => {
                    const av = m.quantity - (m.blocked || 0);
                    return <SelectItem key={m.id} value={m.id} disabled={av < 1}>{m.name} (disp: {av})</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </FieldLabel>
            <FieldLabel label="Cantidad">
              <Input type="number" min={1} data-testid="block-quantity" value={matForm.quantity} onChange={(e) => setMatForm({ ...matForm, quantity: parseInt(e.target.value || "1") })} />
            </FieldLabel>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatOpen(false)}>Cancelar</Button>
            <Button onClick={blockMaterial} style={{ background: "var(--accent)" }} data-testid="confirm-block-btn">Bloquear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rental dialog */}
      <Dialog open={rentOpen} onOpenChange={setRentOpen}>
        <DialogContent data-testid="rental-dialog">
          <DialogHeader><DialogTitle>Material de alquiler externo</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <FieldLabel label="Material">
              <Input data-testid="rental-name" value={rentForm.name} onChange={(e) => setRentForm({ ...rentForm, name: e.target.value })} />
            </FieldLabel>
            <FieldLabel label="Cantidad">
              <Input type="number" min={1} data-testid="rental-qty" value={rentForm.quantity} onChange={(e) => setRentForm({ ...rentForm, quantity: parseInt(e.target.value || "1") })} />
            </FieldLabel>
            <FieldLabel label="Empresa proveedora">
              <Select value={rentForm.provider_id || "none"} onValueChange={(v) => setRentForm({ ...rentForm, provider_id: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="rental-provider"><SelectValue placeholder="Sin empresa..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Sin empresa —</SelectItem>
                  {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {providers.length === 0 && <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 6 }}>Crea proveedores en <Link to="/proveedores" className="subtle-link">Proveedores</Link>.</p>}
            </FieldLabel>
            <FieldLabel label="Notas">
              <Textarea rows={2} data-testid="rental-notes" value={rentForm.notes} onChange={(e) => setRentForm({ ...rentForm, notes: e.target.value })} />
            </FieldLabel>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRentOpen(false)}>Cancelar</Button>
            <Button onClick={addRental} style={{ background: "var(--accent)" }} data-testid="confirm-rental-btn">Añadir</Button>
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
      {!edit ? (
        <div style={{ fontSize: 14, fontWeight: multi ? 400 : 500, color: "var(--ink)", whiteSpace: "pre-wrap" }}>{display ?? (value || "—")}</div>
      ) : select ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{select.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
        </Select>
      ) : multi ? (
        <Textarea rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input type={type || "text"} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function FieldLabel({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
