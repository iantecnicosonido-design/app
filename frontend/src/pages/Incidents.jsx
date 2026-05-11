import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, API } from "../lib/api";
import { Plus, Wrench, FileText, Image as ImgIcon, X, Filter } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import SearchSelect from "../components/SearchSelect";
import { toast } from "sonner";

const TYPE_LABELS = {
  report: { label: "Reporte", color: "var(--bad)", bg: "#fee2e2" },
  update: { label: "Actualización", color: "var(--warn)", bg: "#fef3c7" },
  resolve: { label: "Resuelto", color: "var(--good)", bg: "#dcfce7" },
};

export default function Incidents() {
  const [params, setParams] = useSearchParams();
  const initialMaterial = params.get("material_id") || "";
  const initialUnit = params.get("unit_id") || "";
  const initialVehicle = params.get("vehicle_id") || "";

  const [tab, setTab] = useState(initialMaterial || initialUnit || initialVehicle ? "history" : "active");
  const [list, setList] = useState([]);
  const [logs, setLogs] = useState([]);
  const [units, setUnits] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const [openNew, setOpenNew] = useState(false);
  const [openHistory, setOpenHistory] = useState(null);
  const [history, setHistory] = useState([]);
  const [openResolve, setOpenResolve] = useState(null);
  const [form, setForm] = useState({ target: "unit", unit_id: "", vehicle_id: "", status: "broken", description: "", files: [] });
  const [resolveForm, setResolveForm] = useState({ description: "", files: [] });

  const [filterMaterial, setFilterMaterial] = useState(initialMaterial);
  const [filterUnit, setFilterUnit] = useState(initialUnit);
  const [filterVehicle, setFilterVehicle] = useState(initialVehicle);
  const [filterType, setFilterType] = useState("all");

  const loadActive = async () => {
    setList((await api.get("/incidents")).data);
    setUnits((await api.get("/units")).data);
    setMaterials((await api.get("/materials")).data);
    setVehicles((await api.get("/vehicles")).data);
  };

  const loadHistory = async () => {
    const q = {};
    if (filterVehicle) q.vehicle_id = filterVehicle;
    else if (filterUnit) q.unit_id = filterUnit;
    else if (filterMaterial) q.material_id = filterMaterial;
    if (filterType && filterType !== "all") q.type = filterType;
    setLogs((await api.get("/incident-logs", { params: q })).data);
  };

  useEffect(() => { loadActive(); }, []);
  useEffect(() => { if (tab === "history") loadHistory(); /* eslint-disable-next-line */ }, [tab, filterMaterial, filterUnit, filterVehicle, filterType]);

  // sync URL
  useEffect(() => {
    const next = {};
    if (filterMaterial) next.material_id = filterMaterial;
    if (filterUnit) next.unit_id = filterUnit;
    if (filterVehicle) next.vehicle_id = filterVehicle;
    setParams(next, { replace: true });
    /* eslint-disable-next-line */
  }, [filterMaterial, filterUnit, filterVehicle]);

  const upload = async (files, target) => {
    const uploaded = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        uploaded.push(r.data);
      } catch { toast.error(`Error subiendo ${f.name}`); }
    }
    if (target === "new") setForm((s) => ({ ...s, files: [...s.files, ...uploaded] }));
    else setResolveForm((s) => ({ ...s, files: [...s.files, ...uploaded] }));
  };

  const submitNew = async () => {
    if (form.target === "unit" && !form.unit_id) { toast.error("Elige una unidad"); return; }
    if (form.target === "vehicle" && !form.vehicle_id) { toast.error("Elige un vehículo"); return; }
    if (!form.description.trim()) { toast.error("Describe la avería"); return; }
    try {
      const payload = {
        status: form.status, description: form.description, files: form.files,
        ...(form.target === "unit" ? { unit_id: form.unit_id } : { vehicle_id: form.vehicle_id }),
      };
      await api.post("/incidents", payload);
      toast.success("Incidencia registrada");
      setOpenNew(false);
      setForm({ target: "unit", unit_id: "", vehicle_id: "", status: "broken", description: "", files: [] });
      loadActive(); if (tab === "history") loadHistory();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const showHistory = async (item) => {
    if (item.kind === "vehicle") {
      const r = await api.get(`/vehicles/${item.vehicle.id}/history`);
      setHistory(r.data); setOpenHistory(item);
    } else {
      const r = await api.get(`/units/${item.unit.id}/history`);
      setHistory(r.data); setOpenHistory(item);
    }
  };

  const submitResolve = async () => {
    try {
      if (openResolve.kind === "vehicle") {
        await api.post(`/vehicle-incidents/${openResolve.vehicle.id}/resolve`, resolveForm);
        toast.success("Resuelto, vehículo disponible");
      } else {
        await api.post(`/incidents/${openResolve.unit.id}/resolve`, resolveForm);
        toast.success("Resuelto, unidad disponible");
      }
      setOpenResolve(null);
      setResolveForm({ description: "", files: [] });
      loadActive(); if (tab === "history") loadHistory();
    } catch { toast.error("Error"); }
  };

  const availableUnits = units.filter((u) => u.status === "available");
  const availableVehicles = vehicles.filter((v) => v.status === "available");

  const filterMatName = useMemo(() => materials.find((m) => m.id === filterMaterial)?.name, [filterMaterial, materials]);
  const filterUnitRef = useMemo(() => units.find((u) => u.id === filterUnit)?.reference, [filterUnit, units]);
  const filterVehLabel = useMemo(() => {
    const v = vehicles.find((x) => x.id === filterVehicle);
    return v ? `${v.name} ${v.plate}` : null;
  }, [filterVehicle, vehicles]);

  const totalReports = logs.filter((l) => l.type === "report").length;
  const totalResolves = logs.filter((l) => l.type === "resolve").length;

  return (
    <div data-testid="incidents-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Incidencias</h2>
          <p className="page-sub">{list.length} unidades activas en avería o reparación</p>
        </div>
        <Button onClick={() => setOpenNew(true)} style={{ background: "var(--accent)" }} data-testid="new-incident-btn"><Plus size={16} /> Reportar avería</Button>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid var(--line)" }}>
        <TabBtn active={tab === "active"} onClick={() => setTab("active")} testid="tab-active">Activas ({list.length})</TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")} testid="tab-history">Historial</TabBtn>
      </div>

      {tab === "active" ? (
        list.length === 0 ? (
          <div className="card-paper" style={{ textAlign: "center", padding: 60, color: "var(--ink-mute)" }}>
            <Wrench size={32} style={{ marginBottom: 10, opacity: 0.4 }} /><br />
            Sin incidencias activas. Todo el inventario está disponible.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {list.map((it) => {
              const isVeh = it.kind === "vehicle";
              const ref = isVeh ? it.vehicle.plate : it.unit.reference;
              const name = isVeh ? it.vehicle.name : (it.material?.name || "—");
              const status = isVeh ? it.vehicle.status : it.unit.status;
              const key = isVeh ? `v-${it.vehicle.id}` : `u-${it.unit.id}`;
              return (
                <div key={key} className="card-paper" style={{ display: "grid", gridTemplateColumns: "120px 1fr 130px 120px 110px", gap: 14, alignItems: "center" }}>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>{ref}</span>
                  <div>
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                      {isVeh && <span style={{ fontSize: 10, padding: "2px 8px", background: "#e0e7ff", color: "#3730a3", borderRadius: 999, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase" }}>VEHÍCULO</span>}
                      <span>{name}</span>
                    </div>
                    {it.latest && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 4 }}>{it.latest.description}</div>}
                  </div>
                  <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: status === "broken" ? "#fee2e2" : "#fef3c7", color: status === "broken" ? "#991b1b" : "#92400e", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>{status === "broken" ? "AVERIADO" : "REPARACIÓN"}</span>
                  <Button size="sm" variant="outline" onClick={() => showHistory(it)}>Histórico</Button>
                  <Button size="sm" onClick={() => setOpenResolve(it)} style={{ background: "var(--good)" }}>Resolver</Button>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div>
          <div className="card-paper" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace" }}>
              <Filter size={12} /> Filtros
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 160px 100px", gap: 10, alignItems: "end" }}>
              <Lbl label="Material">
                <SearchSelect
                  placeholder="Cualquiera"
                  value={filterMaterial}
                  onChange={(v) => { setFilterMaterial(v); setFilterUnit(""); setFilterVehicle(""); }}
                  allowClear
                  options={materials.map((m) => ({ value: m.id, label: `${m.reference} · ${m.name}`, sub: m.category, keywords: m.name }))}
                />
              </Lbl>
              <Lbl label="Unidad concreta">
                <SearchSelect
                  placeholder="Cualquier unidad"
                  value={filterUnit}
                  onChange={(v) => { setFilterUnit(v); setFilterVehicle(""); }}
                  allowClear
                  options={units.filter((u) => !filterMaterial || u.material_id === filterMaterial).map((u) => {
                    const m = materials.find((mm) => mm.id === u.material_id);
                    return { value: u.id, label: u.reference, sub: m?.name || "", keywords: m?.name || "" };
                  })}
                />
              </Lbl>
              <Lbl label="Vehículo">
                <SearchSelect
                  placeholder="Cualquier vehículo"
                  value={filterVehicle}
                  onChange={(v) => { setFilterVehicle(v); setFilterMaterial(""); setFilterUnit(""); }}
                  allowClear
                  options={vehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.name}`, sub: "", keywords: v.name }))}
                />
              </Lbl>
              <Lbl label="Tipo">
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="report">Solo reportes</SelectItem>
                    <SelectItem value="update">Solo actualizaciones</SelectItem>
                    <SelectItem value="resolve">Solo resoluciones</SelectItem>
                  </SelectContent>
                </Select>
              </Lbl>
              {(filterMaterial || filterUnit || filterVehicle || filterType !== "all") && (
                <Button variant="outline" size="sm" onClick={() => { setFilterMaterial(""); setFilterUnit(""); setFilterVehicle(""); setFilterType("all"); }}>Limpiar</Button>
              )}
            </div>
            {(filterMaterial || filterUnit || filterVehicle) && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-mute)" }}>
                {filterMaterial && <>Filtrando por material <b>{filterMatName}</b>. </>}
                {filterUnit && <>Unidad <b>{filterUnitRef}</b>. </>}
                {filterVehicle && <>Vehículo <b>{filterVehLabel}</b>. </>}
                {totalReports} reporte(s) · {totalResolves} resolución(es).
              </div>
            )}
          </div>

          {logs.length === 0 ? (
            <div className="card-paper" style={{ textAlign: "center", padding: 60, color: "var(--ink-mute)" }}>
              Sin registros que coincidan con los filtros.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {logs.map((h) => {
                const t = TYPE_LABELS[h.type] || { label: h.type, color: "var(--ink-mute)", bg: "#f5f5f4" };
                const isVeh = !!h.vehicle;
                const ref = isVeh ? h.vehicle.plate : (h.unit?.reference || "—");
                const name = isVeh ? h.vehicle.name : (h.material?.name || "—");
                const subref = isVeh ? "vehículo" : (h.material?.reference || "");
                return (
                  <div key={h.id} className="card-paper" style={{ padding: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 110px 1fr 160px", gap: 12, alignItems: "center", marginBottom: 6 }}>
                      <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: t.bg, color: t.color, textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "center" }}>{t.label} · {h.status}</span>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{ref}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                          {isVeh && <span style={{ fontSize: 9, padding: "2px 6px", background: "#e0e7ff", color: "#3730a3", borderRadius: 999, fontFamily: "JetBrains Mono, monospace" }}>VEHÍCULO</span>}
                          {name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>{subref}</div>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)", textAlign: "right" }}>{new Date(h.created_at).toLocaleString("es-ES")}</span>
                    </div>
                    {h.description && <p style={{ fontSize: 13, margin: "6px 0", paddingLeft: 134, color: "var(--ink-soft)" }}>{h.description}</p>}
                    {h.files && h.files.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, paddingLeft: 134 }}>
                        {h.files.map((f, i) => <FilePill key={i} file={f} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent style={{ maxWidth: 600 }}>
          <DialogHeader><DialogTitle>Reportar incidencia</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Tipo de elemento">
              <div style={{ display: "flex", gap: 6 }}>
                <Button size="sm" variant={form.target === "unit" ? "default" : "outline"} onClick={() => setForm({ ...form, target: "unit", vehicle_id: "" })} style={form.target === "unit" ? { background: "var(--accent)" } : {}} data-testid="incident-target-unit">Material</Button>
                <Button size="sm" variant={form.target === "vehicle" ? "default" : "outline"} onClick={() => setForm({ ...form, target: "vehicle", unit_id: "" })} style={form.target === "vehicle" ? { background: "var(--accent)" } : {}} data-testid="incident-target-vehicle">Vehículo</Button>
              </div>
            </Lbl>
            {form.target === "unit" ? (
              <Lbl label="Unidad afectada">
                <SearchSelect
                  placeholder="Buscar por referencia o nombre..."
                  value={form.unit_id}
                  onChange={(v) => setForm({ ...form, unit_id: v })}
                  options={availableUnits.map((u) => {
                    const m = materials.find((x) => x.id === u.material_id);
                    return { value: u.id, label: `${u.reference} · ${m?.name || ""}`, sub: m?.category || "", keywords: m?.name || "" };
                  })}
                />
              </Lbl>
            ) : (
              <Lbl label="Vehículo afectado">
                <SearchSelect
                  placeholder="Buscar por matrícula o nombre..."
                  value={form.vehicle_id}
                  onChange={(v) => setForm({ ...form, vehicle_id: v })}
                  options={availableVehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.name}`, sub: "", keywords: v.name }))}
                />
              </Lbl>
            )}
            <Lbl label="Estado">
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="broken">Averiado</SelectItem>
                  <SelectItem value="repair">En reparación</SelectItem>
                </SelectContent>
              </Select>
            </Lbl>
            <Lbl label="Descripción"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Lbl>
            <Lbl label="Archivos (fotos / PDF)">
              <Input type="file" multiple accept="image/*,application/pdf" onChange={(e) => upload(Array.from(e.target.files || []), "new")} />
              {form.files.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {form.files.map((f, i) => <FilePill key={i} file={f} onRemove={() => setForm({ ...form, files: form.files.filter((_, idx) => idx !== i) })} />)}
                </div>
              )}
            </Lbl>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenNew(false)}>Cancelar</Button>
            <Button onClick={submitNew} style={{ background: "var(--accent)" }}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openResolve} onOpenChange={(o) => !o && setOpenResolve(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolver incidencia</DialogTitle></DialogHeader>
          {openResolve && <p style={{ color: "var(--ink-mute)", fontSize: 13 }}>Marca <b>{openResolve.kind === "vehicle" ? `${openResolve.vehicle.plate} (${openResolve.vehicle.name})` : openResolve.unit.reference}</b> como disponible.</p>}
          <Lbl label="Notas de resolución"><Textarea rows={3} value={resolveForm.description} onChange={(e) => setResolveForm({ ...resolveForm, description: e.target.value })} /></Lbl>
          <Lbl label="Archivos">
            <Input type="file" multiple accept="image/*,application/pdf" onChange={(e) => upload(Array.from(e.target.files || []), "resolve")} />
            {resolveForm.files.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {resolveForm.files.map((f, i) => <FilePill key={i} file={f} onRemove={() => setResolveForm({ ...resolveForm, files: resolveForm.files.filter((_, idx) => idx !== i) })} />)}
              </div>
            )}
          </Lbl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenResolve(null)}>Cancelar</Button>
            <Button onClick={submitResolve} style={{ background: "var(--good)" }}>Resolver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openHistory} onOpenChange={(o) => !o && setOpenHistory(null)}>
        <DialogContent style={{ maxWidth: 640 }}>
          <DialogHeader><DialogTitle>Histórico · {openHistory?.kind === "vehicle" ? `${openHistory?.vehicle?.plate} ${openHistory?.vehicle?.name}` : openHistory?.unit?.reference}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 10, maxHeight: "60vh", overflowY: "auto" }}>
            {history.map((h) => (
              <div key={h.id} className="card-paper" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: h.type === "resolve" ? "var(--good)" : "var(--warn)" }}>{h.type} · {h.status}</span>
                  <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)" }}>{new Date(h.created_at).toLocaleString("es-ES")}</span>
                </div>
                {h.description && <p style={{ fontSize: 13, margin: "6px 0" }}>{h.description}</p>}
                {h.files && h.files.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {h.files.map((f, i) => <FilePill key={i} file={f} />)}
                  </div>
                )}
              </div>
            ))}
            {history.length === 0 && <p style={{ color: "var(--ink-mute)" }}>Sin historial.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabBtn({ active, onClick, children, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      style={{
        background: "none",
        border: "none",
        padding: "10px 18px",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? "var(--accent)" : "var(--ink-mute)",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        marginBottom: -1,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function FilePill({ file, onRemove }) {
  const isImg = (file.content_type || "").startsWith("image/");
  const url = `${API}/files/${file.path || file.storage_path}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", border: "1px solid var(--line)", borderRadius: 999, fontSize: 12, color: "var(--ink-soft)", textDecoration: "none", background: "#fff" }}>
      {isImg ? <ImgIcon size={12} /> : <FileText size={12} />}
      <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name || "archivo"}</span>
      {onRemove && <button onClick={(e) => { e.preventDefault(); onRemove(); }} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={12} /></button>}
    </a>
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
