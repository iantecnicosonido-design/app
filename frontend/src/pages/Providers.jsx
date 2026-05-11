import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Plus, Trash2, Pencil, Building2, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";

const empty = { name: "", contact: "", phone: "", email: "", notes: "" };

const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export default function Providers() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [query, setQuery] = useState("");

  const load = async () => {
    const r = await api.get("/providers");
    setItems(r.data);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return items;
    return items.filter((p) => [p.name, p.contact, p.phone, p.email, p.notes].some((f) => norm(f).includes(q)));
  }, [items, query]);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    try {
      if (editing) await api.put(`/providers/${editing.id}`, form);
      else await api.post("/providers", form);
      toast.success(editing ? "Actualizado" : "Creado");
      setOpen(false); setForm(empty); setEditing(null);
      load();
    } catch (e) { toast.error("Error"); }
  };

  const remove = async (p) => {
    if (!window.confirm(`¿Eliminar "${p.name}"?`)) return;
    await api.delete(`/providers/${p.id}`);
    toast.success("Eliminado");
    load();
  };

  return (
    <div data-testid="providers-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Proveedores</h2>
          <p className="page-sub">{filtered.length} de {items.length} · empresas a las que alquilas material</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} style={{ background: "var(--accent)" }} data-testid="new-provider-btn">
          <Plus size={16} /> Nuevo proveedor
        </Button>
      </div>

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-mute)" }} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar proveedor por nombre, contacto, teléfono..." style={{ paddingLeft: 36 }} data-testid="providers-search" />
      </div>

      {filtered.length === 0 ? (
        <div className="card-paper" style={{ textAlign: "center", padding: 60, color: "var(--ink-mute)" }}>
          <Building2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} /><br />
          {items.length === 0 ? "Aún no hay proveedores." : "Ningún proveedor coincide con la búsqueda."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
          {filtered.map((p) => (
            <div key={p.id} className="card-paper" data-testid={`provider-${p.id}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{p.name}</h3>
                <div style={{ display: "flex", gap: 4 }}>
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setForm({ name: p.name, contact: p.contact, phone: p.phone, email: p.email, notes: p.notes }); setOpen(true); }}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p)}><Trash2 size={14} /></Button>
                </div>
              </div>
              {p.contact && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>👤 {p.contact}</div>}
              {p.phone && <div style={{ fontSize: 13, color: "var(--ink-soft)", fontFamily: "JetBrains Mono, monospace" }}>{p.phone}</div>}
              {p.email && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{p.email}</div>}
              {p.notes && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>{p.notes}</div>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="provider-dialog">
          <DialogHeader><DialogTitle>{editing ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Nombre"><Input data-testid="provider-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Lbl>
            <Lbl label="Contacto"><Input data-testid="provider-contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Lbl>
            <Lbl label="Teléfono"><Input data-testid="provider-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Lbl>
            <Lbl label="Email"><Input data-testid="provider-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Lbl>
            <Lbl label="Notas"><Textarea rows={3} data-testid="provider-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-provider-btn">{editing ? "Guardar" : "Crear"}</Button>
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
