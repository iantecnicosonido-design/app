import { useEffect, useMemo, useState } from "react";
import { api, CATEGORIES } from "../lib/api";
import { Plus, Search, Trash2, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import SearchSelect from "../components/SearchSelect";
import { toast } from "sonner";

const STATUS_BADGE = {
  available: { bg: "#dcfce7", color: "#166534", label: "DISP" },
  broken: { bg: "#fee2e2", color: "#991b1b", label: "AVERIADO" },
  repair: { bg: "#fef3c7", color: "#92400e", label: "REPARACIÓN" },
};

export default function Inventory() {
  const [materials, setMaterials] = useState([]);
  const [units, setUnits] = useState({});         // { material_id: [units] }
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [matOpen, setMatOpen] = useState(false);
  const [editingMat, setEditingMat] = useState(null);
  const [matForm, setMatForm] = useState({ category: "audio", name: "", reference: "", quantity: 1 });
  const [unitOpen, setUnitOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState(null);
  const [unitForm, setUnitForm] = useState({ reference: "", subitems: [], notes: "" });
  const [allUnits, setAllUnits] = useState([]);
  const [allMaterials, setAllMaterials] = useState([]);
  const [expanded, setExpanded] = useState({});

  const load = async () => {
    const params = {};
    if (cat !== "all") params.category = cat;
    if (q) params.q = q;
    const r = await api.get("/materials", { params });
    setMaterials(r.data);
    const all = await api.get("/units");
    setAllUnits(all.data);
    const allM = await api.get("/materials");
    setAllMaterials(allM.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cat]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  const grouped = useMemo(() => {
    const g = { audio: [], video: [], luces: [], estructuras: [] };
    materials.forEach((i) => g[i.category]?.push(i));
    return g;
  }, [materials]);

  const toggleExpand = async (m) => {
    const isOpen = !expanded[m.id];
    setExpanded({ ...expanded, [m.id]: isOpen });
    if (isOpen && !units[m.id]) {
      const r = await api.get("/units", { params: { material_id: m.id } });
      setUnits({ ...units, [m.id]: r.data });
    }
  };

  const reloadUnits = async (mid) => {
    const r = await api.get("/units", { params: { material_id: mid } });
    setUnits((u) => ({ ...u, [mid]: r.data }));
    const all = await api.get("/units");
    setAllUnits(all.data);
  };

  const submitMat = async () => {
    if (!matForm.name.trim()) { toast.error("Nombre obligatorio"); return; }
    const payload = { ...matForm };
    if (!payload.reference) delete payload.reference;
    try {
      if (editingMat) {
        const upd = { category: payload.category, name: payload.name, reference: payload.reference };
        await api.put(`/materials/${editingMat.id}`, upd);
      } else {
        await api.post("/materials", payload);
      }
      toast.success(editingMat ? "Actualizado" : "Creado");
      setMatOpen(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const removeMat = async (it) => {
    if (!window.confirm(`¿Eliminar "${it.name}" y todas sus unidades?`)) return;
    try {
      await api.delete(`/materials/${it.id}`);
      toast.success("Eliminado");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const addUnit = async (m) => {
    try {
      await api.post(`/materials/${m.id}/units`);
      toast.success("Unidad añadida");
      reloadUnits(m.id);
      load();
    } catch (e) { toast.error("Error"); }
  };

  const startEditUnit = (u) => {
    setEditingUnit(u);
    setUnitForm({
      reference: u.reference,
      subitems: (u.subitems || []).map((s) => ({ type: s.type, unit_id: s.unit_id || "", name: s.name, qty: s.qty || 1, unit_reference: s.unit_reference || "" })),
      notes: u.notes || "",
    });
    setUnitOpen(true);
  };

  const submitUnit = async () => {
    try {
      await api.put(`/units/${editingUnit.id}`, unitForm);
      toast.success("Unidad actualizada");
      setUnitOpen(false);
      reloadUnits(editingUnit.material_id);
    } catch (e) { toast.error("Error"); }
  };

  const removeUnit = async (u) => {
    if (!window.confirm(`¿Eliminar unidad ${u.reference}?`)) return;
    try {
      await api.delete(`/units/${u.id}`);
      toast.success("Eliminada");
      reloadUnits(u.material_id);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const addSubitem = (type) => setUnitForm({ ...unitForm, subitems: [...unitForm.subitems, { type, unit_id: "", name: "", qty: 1, unit_reference: "" }] });
  const updateSub = (i, patch) => {
    const copy = [...unitForm.subitems];
    copy[i] = { ...copy[i], ...patch };
    setUnitForm({ ...unitForm, subitems: copy });
  };
  const removeSub = (i) => setUnitForm({ ...unitForm, subitems: unitForm.subitems.filter((_, idx) => idx !== i) });

  return (
    <div data-testid="inventory-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Inventario</h2>
          <p className="page-sub">{materials.length} referencias · cada una con sus unidades individuales</p>
        </div>
        <Button onClick={() => { setEditingMat(null); setMatForm({ category: cat === "all" ? "audio" : cat, name: "", reference: "", quantity: 1 }); setMatOpen(true); }} style={{ background: "var(--accent)" }} data-testid="add-material-btn"><Plus size={16} /> Nueva referencia</Button>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "var(--ink-mute)" }} />
          <Input data-testid="material-search" placeholder="Buscar por nombre, referencia o nº de unidad..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger style={{ width: 200 }}><SelectValue /></SelectTrigger>
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
          <div key={c.key} className="card-paper" style={{ marginBottom: 16, padding: 0 }}>
            <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <span className={`cat-pill cat-${c.key}`}>{c.label}</span>
              <span style={{ color: "var(--ink-mute)", fontSize: 13 }}>{list.length} ítems</span>
            </div>
            <div>
              {list.map((it) => {
                const isOpen = expanded[it.id];
                const available = (it.quantity || 0) - (it.blocked || 0);
                return (
                  <div key={it.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="row-hover" style={{ display: "grid", gridTemplateColumns: "30px 110px 1fr 90px 90px 110px", gap: 12, padding: "12px 22px", alignItems: "center" }}>
                      <button onClick={() => toggleExpand(it)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-soft)" }}>
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{it.reference}</span>
                      <div style={{ fontWeight: 500 }}>{it.name}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>{it.quantity} unid.</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: available < 1 ? "var(--bad)" : "var(--good)" }}>Disp: {available}</div>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <Button size="icon" variant="ghost" onClick={() => addUnit(it)} title="Añadir unidad"><Plus size={14} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { setEditingMat(it); setMatForm({ category: it.category, name: it.name, reference: it.reference, quantity: it.quantity }); setMatOpen(true); }}><Pencil size={14} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => removeMat(it)}><Trash2 size={14} /></Button>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ background: "#faf6ef", padding: "10px 22px 14px 80px", borderTop: "1px dashed var(--line)" }}>
                        {(units[it.id] || []).map((u) => {
                          const sb = STATUS_BADGE[u.status];
                          return (
                            <div key={u.id} style={{ padding: "8px 0", borderBottom: "1px dashed #e7e2d8", display: "flex", alignItems: "center", gap: 12 }}>
                              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600, minWidth: 110 }}>{u.reference}</span>
                              <span style={{ background: sb.bg, color: sb.color, fontSize: 10, padding: "2px 8px", borderRadius: 999, fontWeight: 600, letterSpacing: "0.04em" }}>{sb.label}</span>
                              <div style={{ flex: 1, fontSize: 12, color: "var(--ink-mute)" }}>
                                {(u.subitems || []).length > 0 && <span><i>incluye:</i> {u.subitems.map((s) => {
                                  if (s.type === "unit" && s.unit_id) {
                                    const subU = allUnits.find((x) => x.id === s.unit_id);
                                    const subM = subU ? allMaterials.find((mm) => mm.id === subU.material_id) : null;
                                    const ref = s.unit_reference || subU?.reference || "";
                                    const nm = subM?.name || (s.name && !s.name.startsWith("(") ? s.name : "");
                                    return `(${ref}) [${nm}]`;
                                  }
                                  return s.name;
                                }).join(", ")}</span>}
                                {u.notes && <span style={{ marginLeft: 8 }}>· {u.notes}</span>}
                              </div>
                              <Button size="icon" variant="ghost" onClick={() => startEditUnit(u)}><Pencil size={12} /></Button>
                              <Button size="icon" variant="ghost" onClick={() => removeUnit(u)}><Trash2 size={12} /></Button>
                            </div>
                          );
                        })}
                        {(units[it.id] || []).length === 0 && <div style={{ color: "var(--ink-mute)", fontSize: 13 }}>Sin unidades.</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <Dialog open={matOpen} onOpenChange={setMatOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingMat ? "Editar referencia" : "Nueva referencia de material"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <Lbl label="Categoría">
              <Select value={matForm.category} onValueChange={(v) => setMatForm({ ...matForm, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </Lbl>
            <Lbl label="Referencia base"><Input placeholder="auto" value={matForm.reference} onChange={(e) => setMatForm({ ...matForm, reference: e.target.value })} /></Lbl>
            <Lbl label="Nombre" full><Input value={matForm.name} onChange={(e) => setMatForm({ ...matForm, name: e.target.value })} data-testid="material-name" /></Lbl>
            {!editingMat && <Lbl label="Cantidad inicial"><Input type="number" min={1} value={matForm.quantity} onChange={(e) => setMatForm({ ...matForm, quantity: parseInt(e.target.value || "1") })} /></Lbl>}
            {editingMat && <p style={{ fontSize: 12, color: "var(--ink-mute)", gridColumn: "1 / -1" }}>Para añadir/quitar unidades usa los botones <Plus size={12} style={{ verticalAlign: "-1px" }} /> de cada referencia.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatOpen(false)}>Cancelar</Button>
            <Button onClick={submitMat} style={{ background: "var(--accent)" }} data-testid="save-material-btn">{editingMat ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unitOpen} onOpenChange={setUnitOpen}>
        <DialogContent style={{ maxWidth: 720 }}>
          <DialogHeader><DialogTitle>Unidad {editingUnit?.reference}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Referencia"><Input value={unitForm.reference} onChange={(e) => setUnitForm({ ...unitForm, reference: e.target.value })} /></Lbl>
            <Lbl label="Notas"><Input value={unitForm.notes} onChange={(e) => setUnitForm({ ...unitForm, notes: e.target.value })} /></Lbl>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace" }}>Subítems incluidos</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button size="sm" variant="outline" onClick={() => addSubitem("unit")}>+ del inventario</Button>
                  <Button size="sm" variant="outline" onClick={() => addSubitem("free")}>+ texto libre</Button>
                </div>
              </div>
              {unitForm.subitems.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>Añade los accesorios que acompañan a esta unidad.</p>}
              {unitForm.subitems.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: s.type === "unit" ? "1fr 80px 36px" : "1fr 80px 36px", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  {s.type === "unit" ? (
                    <SearchSelect
                      placeholder="Buscar unidad por referencia o nombre..."
                      value={s.unit_id}
                      onChange={(v) => {
                        const u = allUnits.find((x) => x.id === v);
                        const m = u ? allMaterials.find((mm) => mm.id === u.material_id) : null;
                        updateSub(i, { unit_id: v, unit_reference: u?.reference || "", name: m?.name || "" });
                      }}
                      options={allUnits.filter((x) => x.id !== editingUnit?.id).map((x) => {
                        const m = allMaterials.find((mm) => mm.id === x.material_id);
                        return { value: x.id, label: `${x.reference} · ${m?.name || ""}`, sub: x.notes || "", keywords: (m?.name || "") + " " + (m?.category || "") };
                      })}
                    />
                  ) : (
                    <Input placeholder="Descripción libre" value={s.name} onChange={(e) => updateSub(i, { name: e.target.value })} />
                  )}
                  <Input type="number" min={1} value={s.qty} onChange={(e) => updateSub(i, { qty: parseInt(e.target.value || "1") })} />
                  <Button size="icon" variant="ghost" onClick={() => removeSub(i)}><Trash2 size={14} /></Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitOpen(false)}>Cancelar</Button>
            <Button onClick={submitUnit} style={{ background: "var(--accent)" }}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Lbl({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      <label style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
