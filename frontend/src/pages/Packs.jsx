import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Plus, Trash2, Pencil, Package, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import SearchSelect from "../components/SearchSelect";
import { toast } from "sonner";

export default function Packs() {
  const [packs, setPacks] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [categories, setCategories] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "", items: [] });
  const [query, setQuery] = useState("");

  const normalize = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return packs;
    return packs.filter((p) => {
      if (normalize(p.name).includes(q) || normalize(p.description).includes(q)) return true;
      // also search inside its materials
      return (p.items || []).some((it) => {
        const m = materials.find((x) => x.id === it.material_id);
        return m && (normalize(m.name).includes(q) || normalize(m.reference).includes(q));
      });
    });
  }, [packs, query, materials]);

  const load = async () => {
    setPacks((await api.get("/packs")).data);
    setMaterials((await api.get("/materials")).data);
    setCategories((await api.get("/categories")).data);
  };
  useEffect(() => { load(); }, []);

  const startCreate = () => { setEditing(null); setForm({ name: "", description: "", items: [] }); setOpen(true); };
  const startEdit = (p) => { setEditing(p); setForm({ name: p.name, description: p.description || "", items: p.items.map((it) => ({ ...it })) }); setOpen(true); };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Nombre obligatorio"); return; }
    if (form.items.length === 0) { toast.error("Añade al menos un material"); return; }
    try {
      if (editing) await api.put(`/packs/${editing.id}`, form);
      else await api.post("/packs", form);
      toast.success(editing ? "Actualizado" : "Creado");
      setOpen(false); load();
    } catch (e) { toast.error("Error"); }
  };

  const remove = async (p) => {
    if (!window.confirm(`¿Eliminar pack "${p.name}"?`)) return;
    await api.delete(`/packs/${p.id}`); toast.success("Eliminado"); load();
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { material_id: "", name: "", quantity: 1 }] });
  const updateItem = (i, patch) => {
    const c = [...form.items]; c[i] = { ...c[i], ...patch }; setForm({ ...form, items: c });
  };
  const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });

  return (
    <div data-testid="packs-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div><h2 className="page-title">Packs</h2><p className="page-sub">{filtered.length} de {packs.length} · plantillas de material para aplicar a eventos</p></div>
        <Button onClick={startCreate} style={{ background: "var(--accent)" }} data-testid="new-pack-btn"><Plus size={16} /> Nuevo pack</Button>
      </div>

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-mute)" }} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pack por nombre, descripción o material que contiene..." style={{ paddingLeft: 36 }} data-testid="packs-search" />
      </div>

      {filtered.length === 0 ? (
        <div className="card-paper" style={{ textAlign: "center", padding: 60, color: "var(--ink-mute)" }}>
          <Package size={32} style={{ marginBottom: 10, opacity: 0.4 }} /><br />
          {packs.length === 0
            ? <>Aún no hay packs. Crea plantillas con material habitual (ej.: "Pack DJ básico") y aplícalos al evento con un clic.</>
            : "Ningún pack coincide con la búsqueda."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
          {filtered.map((p) => (
            <div key={p.id} className="card-paper">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{p.name}</h3>
                <div style={{ display: "flex", gap: 4 }}>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p)}><Trash2 size={14} /></Button>
                </div>
              </div>
              {p.description && <p style={{ fontSize: 13, color: "var(--ink-mute)", marginBottom: 12 }}>{p.description}</p>}
              <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 10 }}>
                {p.items.map((it, i) => {
                  const m = materials.find((x) => x.id === it.material_id);
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
                      <span>{m ? `${m.reference} · ${m.name}` : "(material eliminado)"}</span>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--ink-soft)" }}>x{it.quantity}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{ maxWidth: 720, maxHeight: "92vh", overflowY: "auto" }}>
          <DialogHeader><DialogTitle>{editing ? "Editar pack" : "Nuevo pack"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Nombre"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="pack-name" /></Lbl>
            <Lbl label="Descripción"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Lbl>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace" }}>Materiales</span>
                <Button size="sm" variant="outline" onClick={addItem} data-testid="add-pack-item-btn"><Plus size={12} /> Añadir</Button>
              </div>
              {form.items.map((it, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px 36px", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <Select value={form._cat?.[i] || "all"} onValueChange={(v) => setForm({ ...form, _cat: { ...(form._cat || {}), [i]: v } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {categories.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <SearchSelect
                    placeholder="Buscar material por nombre o referencia..."
                    value={it.material_id}
                    onChange={(v) => {
                      const m = materials.find((x) => x.id === v);
                      updateItem(i, { material_id: v, name: m?.name || "" });
                    }}
                    options={materials.filter((m) => !form._cat?.[i] || form._cat[i] === "all" || m.category === form._cat[i]).map((m) => ({
                      value: m.id, label: `${m.reference} · ${m.name}`, sub: `${m.category} · ${m.quantity} unid.`, keywords: m.name + " " + m.category,
                    }))}
                  />
                  <Input type="number" min={1} value={it.quantity} onChange={(e) => updateItem(i, { quantity: parseInt(e.target.value || "1") })} />
                  <Button size="icon" variant="ghost" onClick={() => removeItem(i)}><Trash2 size={14} /></Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-pack-btn">{editing ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Lbl({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
