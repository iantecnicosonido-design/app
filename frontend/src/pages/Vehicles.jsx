import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Plus, Trash2, Pencil, Truck, Wrench } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";

const STATUS = {
  available: { bg: "#dcfce7", color: "#166534", label: "DISPONIBLE" },
  broken: { bg: "#fee2e2", color: "#991b1b", label: "AVERIADO" },
  repair: { bg: "#fef3c7", color: "#92400e", label: "REPARACIÓN" },
};

export default function Vehicles() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", plate: "", notes: "" });

  const load = async () => {
    setItems((await api.get("/vehicles")).data);
  };
  useEffect(() => { load(); }, []);

  const startCreate = () => { setEditing(null); setForm({ name: "", plate: "", notes: "" }); setOpen(true); };
  const startEdit = (v) => { setEditing(v); setForm({ name: v.name, plate: v.plate, notes: v.notes || "" }); setOpen(true); };

  const submit = async () => {
    if (!form.name.trim() || !form.plate.trim()) { toast.error("Nombre y matrícula obligatorios"); return; }
    try {
      if (editing) await api.put(`/vehicles/${editing.id}`, form);
      else await api.post("/vehicles", form);
      toast.success(editing ? "Actualizado" : "Creado");
      setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const remove = async (v) => {
    if (!window.confirm(`¿Eliminar vehículo ${v.name} ${v.plate}?`)) return;
    try {
      await api.delete(`/vehicles/${v.id}`);
      toast.success("Eliminado");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div data-testid="vehicles-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Vehículos</h2>
          <p className="page-sub">{items.length} vehículo(s) propio(s) · se reservan junto al material en cada bolo</p>
        </div>
        <Button onClick={startCreate} style={{ background: "var(--accent)" }} data-testid="new-vehicle-btn"><Plus size={16} /> Nuevo vehículo</Button>
      </div>

      <div className="card-paper" style={{ padding: 0, marginTop: 18 }}>
        {items.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-mute)" }}>
            <Truck size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p>Aún no hay vehículos. Crea el primero para poder asignarlo a tus eventos.</p>
          </div>
        ) : (
          items.map((v) => {
            const s = STATUS[v.status] || STATUS.available;
            return (
              <div key={v.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "180px 1fr 130px 110px 110px", gap: 12, padding: "14px 22px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>{v.plate}</span>
                <div>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{v.name}</span>
                    {(v.incident_count || 0) > 0 && (
                      <Link
                        to={`/incidencias?vehicle_id=${v.id}`}
                        data-testid={`vehicle-incident-badge-${v.plate}`}
                        title={`Ver ${v.incident_count} incidencia(s) de este vehículo`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fee2e2", color: "#991b1b", fontSize: 11, padding: "2px 8px", borderRadius: 999, fontWeight: 600, textDecoration: "none", fontFamily: "JetBrains Mono, monospace" }}
                      >
                        <Wrench size={11} /> {v.incident_count}
                      </Link>
                    )}
                  </div>
                  {v.notes && <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2, fontStyle: "italic" }}>{v.notes}</div>}
                </div>
                <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: s.bg, color: s.color, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>{s.label}</span>
                <Button size="icon" variant="ghost" onClick={() => startEdit(v)}><Pencil size={14} /></Button>
                <Button size="icon" variant="ghost" onClick={() => remove(v)}><Trash2 size={14} /></Button>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar vehículo" : "Nuevo vehículo"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Nombre"><Input placeholder="Ej: Renault" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="vehicle-name" /></Lbl>
            <Lbl label="Matrícula"><Input placeholder="Ej: 3880LTX" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} data-testid="vehicle-plate" /></Lbl>
            <Lbl label="Notas"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-vehicle-btn">{editing ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
