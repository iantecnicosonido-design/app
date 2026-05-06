import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API, CATEGORIES, formatDate } from "../lib/api";
import { ArrowLeft, FileDown, Lock, Unlock, Plus, Trash2, Save, Search, Package } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
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
  const { id } = useParams();
  const navigate = useNavigate();
  const [ev, setEv] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [providers, setProviders] = useState([]);
  const [packs, setPacks] = useState([]);
  const [matOpen, setMatOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [pickedMat, setPickedMat] = useState(null);
  const [blockQty, setBlockQty] = useState(1);
  const [availability, setAvailability] = useState(null);
  const [rentForm, setRentForm] = useState({ name: "", quantity: 1, provider_id: "", provider_name: "", notes: "" });
  const [edit, setEdit] = useState(null);

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

  const grouped = { audio: [], video: [], luces: [], estructuras: [] };
  ev.materials.forEach((m) => grouped[m.category]?.push(m));

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
          <Button variant="outline" onClick={exportPDF} data-testid="export-pdf-btn"><FileDown size={16} /> PDF</Button>
          {!isClosed ? <Button onClick={closeEvent} style={{ background: "#1c1917" }}><Lock size={16} /> Cerrar</Button> : <Button onClick={reopenEvent} variant="outline"><Unlock size={16} /> Reabrir</Button>}
          <Button variant="ghost" onClick={deleteEvent}><Trash2 size={16} color="#b91c1c" /></Button>
        </div>
      </div>

      <div className="card-paper" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Ficha del evento</h3>
          {!isClosed && !edit && <Button variant="ghost" size="sm" onClick={() => setEdit({ ...ev })}>Editar</Button>}
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
          {!isClosed && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => setPackOpen(true)} variant="outline" size="sm" data-testid="apply-pack-btn"><Package size={14} /> Aplicar pack</Button>
              <Button onClick={() => setMatOpen(true)} style={{ background: "var(--accent)" }} size="sm" data-testid="block-material-btn"><Plus size={14} /> Bloquear material</Button>
            </div>
          )}
        </div>
        {ev.materials.length === 0 ? <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Aún no se ha bloqueado material.</p> : (
          <>
            {CATEGORIES.map((c) => grouped[c.key].length > 0 && (
              <div key={c.key} style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 8 }}><span className={`cat-pill cat-${c.key}`}>{c.label}</span></div>
                {grouped[c.key].map((m) => (
                  <div key={m.material_id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 4px" }}>
                    <div className="row-hover" style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px 60px", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{m.reference || "—"}</span>
                      <div style={{ fontWeight: 500 }}>{m.name}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>x{m.units?.length || 0}</div>
                      <div style={{ textAlign: "right" }}>
                        {!isClosed && <Button size="icon" variant="ghost" onClick={() => unblockMaterial(m.material_id)}><Trash2 size={14} /></Button>}
                      </div>
                    </div>
                    <div style={{ paddingLeft: 110, marginTop: 6 }}>
                      {(m.units || []).map((u) => (
                        <div key={u.unit_id} style={{ fontSize: 12, color: "var(--ink-soft)", padding: "2px 0" }}>
                          • <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)" }}>{u.reference}</span>
                          {(u.subitems || []).map((s, i) => (
                            <div key={i} style={{ marginLeft: 16, fontStyle: "italic", fontSize: 11, color: "var(--ink-mute)" }}>
                              ↳ {s.name}{s.unit_reference && <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)", fontStyle: "normal" }}> [{s.unit_reference}]</span>} <span style={{ fontFamily: "JetBrains Mono, monospace", fontStyle: "normal" }}>x{s.qty}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card-paper">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Material de alquiler externo</h3>
          {!isClosed && <Button onClick={() => setRentOpen(true)} style={{ background: "var(--accent)" }} size="sm"><Plus size={14} /> Añadir alquiler</Button>}
        </div>
        {ev.rentals.length === 0 ? <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Sin material de alquiler externo.</p> : ev.rentals.map((r) => (
          <div key={r.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px 60px", padding: "10px 4px", borderBottom: "1px solid var(--line)", alignItems: "center", gap: 8 }}>
            <div><div style={{ fontWeight: 500 }}>{r.name}</div>{r.notes && <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{r.notes}</div>}</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{r.provider_name || "—"}</div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>x{r.quantity}</div>
            <div style={{ textAlign: "right" }}>{!isClosed && <Button size="icon" variant="ghost" onClick={() => removeRental(r.id)}><Trash2 size={14} /></Button>}</div>
          </div>
        ))}
      </div>

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
                  <button key={m.id} onClick={() => setPickedMat(m)} className="row-hover" style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px", padding: "10px 12px", borderBottom: "1px solid var(--line)", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", borderTop: "none", borderLeft: "none", borderRight: "none" }}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{m.reference}</span>
                    <span style={{ fontSize: 13 }}>{m.name}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-mute)", textAlign: "right" }}>{m.quantity} unid · {m.category}</span>
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

      {/* Rental */}
      <Dialog open={rentOpen} onOpenChange={setRentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Material de alquiler externo</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Material"><Input value={rentForm.name} onChange={(e) => setRentForm({ ...rentForm, name: e.target.value })} /></Lbl>
            <Lbl label="Cantidad"><Input type="number" min={1} value={rentForm.quantity} onChange={(e) => setRentForm({ ...rentForm, quantity: parseInt(e.target.value || "1") })} /></Lbl>
            <Lbl label="Empresa proveedora">
              <Select value={rentForm.provider_id || "none"} onValueChange={(v) => setRentForm({ ...rentForm, provider_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Sin empresa..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Sin empresa —</SelectItem>
                  {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Lbl>
            <Lbl label="Notas"><Textarea rows={2} value={rentForm.notes} onChange={(e) => setRentForm({ ...rentForm, notes: e.target.value })} /></Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRentOpen(false)}>Cancelar</Button>
            <Button onClick={addRental} style={{ background: "var(--accent)" }}>Añadir</Button>
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
