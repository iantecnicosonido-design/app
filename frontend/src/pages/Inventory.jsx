import { useEffect, useMemo, useState } from "react";
import { api, CATEGORIES } from "../lib/api";
import { Plus, Search, Trash2, Pencil } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ category: "audio", name: "", quantity: 1 });

  const load = async () => {
    const params = {};
    if (cat !== "all") params.category = cat;
    if (q) params.q = q;
    const r = await api.get("/materials", { params });
    setItems(r.data);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cat]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q]);

  const grouped = useMemo(() => {
    const g = { audio: [], video: [], luces: [], estructuras: [] };
    items.forEach((i) => g[i.category]?.push(i));
    return g;
  }, [items]);

  const startCreate = () => {
    setEditing(null);
    setForm({ category: cat === "all" ? "audio" : cat, name: "", quantity: 1 });
    setOpen(true);
  };
  const startEdit = (it) => {
    setEditing(it);
    setForm({ category: it.category, name: it.name, quantity: it.quantity });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    try {
      if (editing) {
        await api.put(`/materials/${editing.id}`, form);
        toast.success("Material actualizado");
      } else {
        await api.post("/materials", form);
        toast.success("Material creado");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error");
    }
  };

  const remove = async (it) => {
    if (!window.confirm(`¿Eliminar "${it.name}"?`)) return;
    try {
      await api.delete(`/materials/${it.id}`);
      toast.success("Eliminado");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div data-testid="inventory-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Inventario</h2>
          <p className="page-sub">{items.length} referencias visibles</p>
        </div>
        <Button onClick={startCreate} data-testid="add-material-btn" style={{ background: "var(--accent)" }}>
          <Plus size={16} /> Añadir material
        </Button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "var(--ink-mute)" }} />
          <Input data-testid="material-search" placeholder="Buscar material..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger style={{ width: 200 }} data-testid="category-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {CATEGORIES.map((c) => {
        const list = grouped[c.key];
        if (cat !== "all" && cat !== c.key) return null;
        if (!list || list.length === 0) return null;
        return (
          <div key={c.key} className="card-paper" style={{ marginBottom: 16, padding: 0 }} data-testid={`cat-section-${c.key}`}>
            <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`cat-pill cat-${c.key}`}>{c.label}</span>
                <span style={{ color: "var(--ink-mute)", fontSize: 13 }}>{list.length} ítems</span>
              </div>
            </div>
            <div>
              {list.map((it) => {
                const available = it.quantity - (it.blocked || 0);
                return (
                  <div key={it.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 90px", gap: 12, padding: "12px 22px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                    <div style={{ fontWeight: 500 }}>{it.name}</div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--ink-soft)" }}>Total: {it.quantity}</div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: available < 1 ? "var(--bad)" : "var(--good)" }}>Disp: {available}</div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <Button size="icon" variant="ghost" onClick={() => startEdit(it)} data-testid={`edit-${it.id}`}><Pencil size={14} /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(it)} data-testid={`delete-${it.id}`}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="material-dialog">
          <DialogHeader><DialogTitle>{editing ? "Editar material" : "Nuevo material"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono, monospace" }}>Categoría</label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="material-category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono, monospace" }}>Nombre</label>
              <Input data-testid="material-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono, monospace" }}>Cantidad</label>
              <Input data-testid="material-quantity" type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value || "0") })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-material-btn">{editing ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
