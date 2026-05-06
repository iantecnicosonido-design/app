import { useEffect, useMemo, useState } from "react";
import { api, CATEGORIES } from "../lib/api";
import { Plus, Search, Trash2, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ category: "audio", name: "", reference: "", quantity: 1, subitems: [] });
  const [expanded, setExpanded] = useState({});

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
    setForm({ category: cat === "all" ? "audio" : cat, name: "", reference: "", quantity: 1, subitems: [] });
    setOpen(true);
  };
  const startEdit = (it) => {
    setEditing(it);
    setForm({
      category: it.category, name: it.name, reference: it.reference || "",
      quantity: it.quantity,
      subitems: (it.subitems || []).map((s) => ({ material_id: s.material_id, name: s.name, quantity_per_parent: s.quantity_per_parent })),
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    const payload = { ...form };
    if (!payload.reference) delete payload.reference;
    try {
      if (editing) await api.put(`/materials/${editing.id}`, payload);
      else await api.post("/materials", payload);
      toast.success(editing ? "Actualizado" : "Creado");
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

  const addSubitem = () => setForm({ ...form, subitems: [...form.subitems, { material_id: "", name: "", quantity_per_parent: 1 }] });
  const updateSub = (i, patch) => {
    const copy = [...form.subitems];
    copy[i] = { ...copy[i], ...patch };
    setForm({ ...form, subitems: copy });
  };
  const removeSub = (i) => setForm({ ...form, subitems: form.subitems.filter((_, idx) => idx !== i) });

  const allMaterials = items;
  const toggleExpand = (id) => setExpanded({ ...expanded, [id]: !expanded[id] });

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
          <Input data-testid="material-search" placeholder="Buscar por nombre o referencia..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} />
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
                const hasSubs = (it.subitems || []).length > 0;
                const isOpen = expanded[it.id];
                return (
                  <div key={it.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="row-hover" style={{ display: "grid", gridTemplateColumns: "20px 100px 1fr 100px 100px 90px", gap: 12, padding: "12px 22px", alignItems: "center" }}>
                      <button onClick={() => hasSubs && toggleExpand(it.id)} style={{ background: "none", border: "none", cursor: hasSubs ? "pointer" : "default", color: hasSubs ? "var(--ink-soft)" : "transparent" }}>
                        {hasSubs ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : "·"}
                      </button>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{it.reference || "—"}</span>
                      <div style={{ fontWeight: 500 }}>
                        {it.name}
                        {hasSubs && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>+ {it.subitems.length} subítem{it.subitems.length>1?"s":""}</span>}
                      </div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--ink-soft)" }}>Total: {it.quantity}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: available < 1 ? "var(--bad)" : "var(--good)" }}>Disp: {available}</div>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Button size="icon" variant="ghost" onClick={() => startEdit(it)} data-testid={`edit-${it.id}`}><Pencil size={14} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(it)} data-testid={`delete-${it.id}`}><Trash2 size={14} /></Button>
                      </div>
                    </div>
                    {hasSubs && isOpen && (
                      <div style={{ background: "#faf6ef", padding: "8px 22px 12px 76px", borderTop: "1px dashed var(--line)" }}>
                        {it.subitems.map((s, i) => (
                          <div key={i} style={{ fontSize: 13, color: "var(--ink-soft)", fontStyle: "italic", padding: "3px 0" }}>
                            ↳ {s.name} <span style={{ fontFamily: "JetBrains Mono, monospace", marginLeft: 6, fontStyle: "normal" }}>x{s.quantity_per_parent}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{ maxWidth: 640 }} data-testid="material-dialog">
          <DialogHeader><DialogTitle>{editing ? "Editar material" : "Nuevo material"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <Lbl label="Categoría">
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="material-category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </Lbl>
            <Lbl label="Referencia (auto si vacío)">
              <Input data-testid="material-reference" value={form.reference} placeholder="AUD-0001" onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Lbl>
            <Lbl label="Nombre" full>
              <Input data-testid="material-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Lbl>
            <Lbl label="Cantidad total">
              <Input data-testid="material-quantity" type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value || "0") })} />
            </Lbl>
            <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace" }}>Subítems incluidos por defecto</span>
                <Button size="sm" variant="outline" onClick={addSubitem} data-testid="add-subitem-btn"><Plus size={12} /> Añadir</Button>
              </div>
              {form.subitems.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>Por ejemplo, un altavoz puede llevar un cable Speakon. Cada subítem se descontará del stock al bloquear este material.</p>}
              {form.subitems.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 36px", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <Select value={s.material_id} onValueChange={(v) => {
                    const ref = allMaterials.find((m) => m.id === v);
                    updateSub(i, { material_id: v, name: ref ? ref.name : "" });
                  }}>
                    <SelectTrigger data-testid={`subitem-mat-${i}`}><SelectValue placeholder="Material..." /></SelectTrigger>
                    <SelectContent>
                      {allMaterials.filter((m) => !editing || m.id !== editing.id).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.reference} · {m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" min={1} value={s.quantity_per_parent} onChange={(e) => updateSub(i, { quantity_per_parent: parseInt(e.target.value || "1") })} data-testid={`subitem-qty-${i}`} />
                  <Button size="icon" variant="ghost" onClick={() => removeSub(i)}><Trash2 size={14} /></Button>
                </div>
              ))}
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

function Lbl({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      <label style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
