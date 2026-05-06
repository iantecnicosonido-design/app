import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Plus, Search, Trash2, Pencil, ChevronDown, ChevronRight, Settings } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import SearchSelect from "../components/SearchSelect";
import { toast } from "sonner";

const STATUS_BADGE = {
  available: { bg: "#dcfce7", color: "#166534", label: "DISP" },
  broken: { bg: "#fee2e2", color: "#991b1b", label: "AVERIADO" },
  repair: { bg: "#fef3c7", color: "#92400e", label: "REPARACIÓN" },
};

export default function Inventory() {
  const [categories, setCategories] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [units, setUnits] = useState({});
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
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [catEditing, setCatEditing] = useState(null);
  const [catForm, setCatForm] = useState({ key: "", label: "", prefix: "", has_subitems: true, has_unit_refs: true });

  const catByKey = useMemo(() => Object.fromEntries(categories.map((c) => [c.key, c])), [categories]);

  const load = async () => {
    const params = {};
    if (cat !== "all") params.category = cat;
    if (q) params.q = q;
    const [r, all, allM, cats] = await Promise.all([
      api.get("/materials", { params }),
      api.get("/units"),
      api.get("/materials"),
      api.get("/categories"),
    ]);
    setMaterials(r.data);
    setAllUnits(all.data);
    setAllMaterials(allM.data);
    setCategories(cats.data);
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
          <p className="page-sub">{materials.length} referencias · {categories.length} categorías</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" onClick={() => setCatManagerOpen(true)} data-testid="manage-categories-btn"><Settings size={16} /> Categorías</Button>
          <Button onClick={() => { setEditingMat(null); setMatForm({ category: cat === "all" ? (categories[0]?.key || "audio") : cat, name: "", reference: "", quantity: 1 }); setMatOpen(true); }} style={{ background: "var(--accent)" }} data-testid="add-material-btn"><Plus size={16} /> Nueva referencia</Button>
        </div>
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
            {categories.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {categories.map((c) => {
        const list = grouped[c.key];
        if (cat !== "all" && cat !== c.key) return null;
        if (!list || list.length === 0) return null;
        const hasUnitRefs = c.has_unit_refs;
        return (
          <div key={c.key} className="card-paper" style={{ marginBottom: 16, padding: 0 }}>
            <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
              <span className={`cat-pill cat-${c.key}`} style={{ background: hasUnitRefs ? undefined : "#e7e5e4", color: hasUnitRefs ? undefined : "#44403c" }}>{c.label}</span>
              <span style={{ color: "var(--ink-mute)", fontSize: 13 }}>{list.length} ítems{!hasUnitRefs && " · sin numeración por unidad"}</span>
            </div>
            <div>
              {list.map((it) => {
                const isOpen = expanded[it.id];
                const available = (it.quantity || 0) - (it.blocked || 0);
                return (
                  <div key={it.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <div className="row-hover" style={{ display: "grid", gridTemplateColumns: "30px 110px 1fr 90px 90px 110px", gap: 12, padding: "12px 22px", alignItems: "center" }}>
                      <button onClick={() => hasUnitRefs && toggleExpand(it)} style={{ background: "none", border: "none", cursor: hasUnitRefs ? "pointer" : "default", color: hasUnitRefs ? "var(--ink-soft)" : "transparent" }}>
                        {hasUnitRefs ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : "·"}
                      </button>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{it.reference}</span>
                      <div style={{ fontWeight: 500 }}>{it.name}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>{it.quantity} unid.</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: available < 1 ? "var(--bad)" : "var(--good)" }}>Disp: {available}</div>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        {hasUnitRefs && <Button size="icon" variant="ghost" onClick={() => addUnit(it)} title="Añadir unidad"><Plus size={14} /></Button>}
                        <Button size="icon" variant="ghost" onClick={() => { setEditingMat(it); setMatForm({ category: it.category, name: it.name, reference: it.reference, quantity: it.quantity }); setMatOpen(true); }}><Pencil size={14} /></Button>
                        <Button size="icon" variant="ghost" onClick={() => removeMat(it)}><Trash2 size={14} /></Button>
                      </div>
                    </div>
                    {hasUnitRefs && isOpen && (
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
                <SelectContent>{categories.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
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
      <Dialog open={catManagerOpen} onOpenChange={setCatManagerOpen}>
        <DialogContent style={{ maxWidth: 720, maxHeight: "92vh", overflowY: "auto" }} data-testid="categories-dialog">
          <DialogHeader><DialogTitle>Gestión de categorías</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {categories.map((c) => (
              <div key={c.key} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px", gap: 10, padding: 12, border: "1px solid var(--line)", borderRadius: 8, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>{c.key} · {c.prefix}-XXXX</div>
                </div>
                <span style={{ fontSize: 10, color: c.has_subitems ? "var(--good)" : "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", textAlign: "center" }}>{c.has_subitems ? "subítems" : "sin sub"}</span>
                <span style={{ fontSize: 10, color: c.has_unit_refs ? "var(--good)" : "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", textAlign: "center" }}>{c.has_unit_refs ? "núm. unid." : "sin núm."}</span>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <Button size="icon" variant="ghost" onClick={() => { setCatEditing(c); setCatForm({ key: c.key, label: c.label, prefix: c.prefix, has_subitems: c.has_subitems, has_unit_refs: c.has_unit_refs }); }}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" onClick={async () => {
                    if (!window.confirm(`¿Eliminar categoría "${c.label}"?`)) return;
                    try { await api.delete(`/categories/${c.key}`); toast.success("Eliminada"); load(); }
                    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
                  }}><Trash2 size={14} /></Button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ paddingTop: 14, borderTop: "1px dashed var(--line)" }}>
            <h4 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 700 }}>{catEditing ? `Editar: ${catEditing.label}` : "Nueva categoría"}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 10, alignItems: "end", marginBottom: 10 }}>
              <Lbl label="Nombre"><Input placeholder="Ej: Trussing" value={catForm.label} onChange={(e) => setCatForm({ ...catForm, label: e.target.value })} data-testid="cat-label" /></Lbl>
              <Lbl label="Clave (interna, sin espacios)"><Input placeholder="Ej: trussing" value={catForm.key} onChange={(e) => setCatForm({ ...catForm, key: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "") })} disabled={!!catEditing} /></Lbl>
              <Lbl label="Prefijo"><Input placeholder="TRU" value={catForm.prefix} onChange={(e) => setCatForm({ ...catForm, prefix: e.target.value.toUpperCase().slice(0, 4) })} /></Lbl>
            </div>
            <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <Switch checked={catForm.has_subitems} onCheckedChange={(v) => setCatForm({ ...catForm, has_subitems: v })} data-testid="cat-subitems" />
                <span style={{ fontSize: 13 }}>Permite subítems</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <Switch checked={catForm.has_unit_refs} onCheckedChange={(v) => setCatForm({ ...catForm, has_unit_refs: v })} data-testid="cat-unitrefs" />
                <span style={{ fontSize: 13 }}>Numeración por unidad</span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {catEditing && <Button variant="outline" size="sm" onClick={() => { setCatEditing(null); setCatForm({ key: "", label: "", prefix: "", has_subitems: true, has_unit_refs: true }); }}>Cancelar edición</Button>}
              <Button size="sm" onClick={async () => {
                if (!catForm.key || !catForm.label || !catForm.prefix) { toast.error("Completa los campos"); return; }
                try {
                  if (catEditing) {
                    await api.put(`/categories/${catEditing.key}`, { label: catForm.label, prefix: catForm.prefix, has_subitems: catForm.has_subitems, has_unit_refs: catForm.has_unit_refs });
                    toast.success("Actualizada");
                  } else {
                    await api.post("/categories", catForm);
                    toast.success("Creada");
                  }
                  setCatEditing(null);
                  setCatForm({ key: "", label: "", prefix: "", has_subitems: true, has_unit_refs: true });
                  load();
                } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
              }} style={{ background: "var(--accent)" }} data-testid="save-category-btn">{catEditing ? "Guardar" : "Crear categoría"}</Button>
            </div>
          </div>
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
