import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Plus, Trash2, Pencil, Box } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";

export default function Flightcases() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", notes: "" });

  const load = async () => {
    const r = await api.get("/flightcases");
    setItems(r.data);
  };
  useEffect(() => { load(); }, []);

  const startCreate = () => { setEditing(null); setForm({ name: "", description: "", notes: "" }); setOpen(true); };
  const startEdit = (f) => { setEditing(f); setForm({ name: f.name, description: f.description || "", notes: f.notes || "" }); setOpen(true); };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Nombre obligatorio"); return; }
    try {
      if (editing) await api.put(`/flightcases/${editing.id}`, form);
      else await api.post("/flightcases", form);
      toast.success(editing ? "Actualizado" : "Creado");
      setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const remove = async (f) => {
    if (!window.confirm(`¿Eliminar flightcase "${f.name}"? Se quitará de los eventos donde esté asignado.`)) return;
    try {
      await api.delete(`/flightcases/${f.id}`);
      toast.success("Eliminado");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div data-testid="flightcases-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Flightcases</h2>
          <p className="page-sub">{items.length} flightcase(s) · biblioteca reutilizable para distribuir cableado</p>
        </div>
        <Button onClick={startCreate} style={{ background: "var(--accent)" }} data-testid="new-flightcase-btn"><Plus size={16} /> Nuevo flightcase</Button>
      </div>

      <div className="card-paper" style={{ padding: 0, marginTop: 18 }}>
        {items.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-mute)" }}>
            <Box size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p>Aún no hay flightcases. Crea el primero para empezar a organizar el cableado de tus eventos.</p>
          </div>
        ) : (
          items.map((f) => (
            <div key={f.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12, padding: "14px 22px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{f.name}</div>
                {f.description && <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{f.description}</div>}
                {f.notes && <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2, fontStyle: "italic" }}>{f.notes}</div>}
              </div>
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <Button size="icon" variant="ghost" onClick={() => startEdit(f)}><Pencil size={14} /></Button>
                <Button size="icon" variant="ghost" onClick={() => remove(f)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar flightcase" : "Nuevo flightcase"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Nombre"><Input placeholder="Ej: FC-1 Audio" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="fc-name" /></Lbl>
            <Lbl label="Descripción"><Input placeholder="Breve descripción" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Lbl>
            <Lbl label="Notas"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-fc-btn">{editing ? "Guardar" : "Crear"}</Button>
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
