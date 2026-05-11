import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API } from "../lib/api";
import { ArrowLeft, Lock, Unlock, Search, Trash2, RefreshCw, Package, CheckCheck, FileDown, CheckSquare } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";

const fmtDt = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return s; }
};

export default function EventPrepare() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAlmacen = user?.role === "almacen";
  const isProductor = user?.role === "productor";
  const canEdit = isAlmacen; // only Almacén edits prep; Productor/others see read-only

  const [ev, setEv] = useState(null);
  const [categories, setCategories] = useState([]);
  const [allMaterials, setAllMaterials] = useState([]);
  const [loading, setLoading] = useState(true);

  // Substitute modal
  const [subOpen, setSubOpen] = useState(false);
  const [subCtx, setSubCtx] = useState(null); // { material_id, old_unit_id, old_reference, old_material_name }
  const [subSearchQ, setSubSearchQ] = useState("");
  const [subPickedMat, setSubPickedMat] = useState(null);
  const [subAvail, setSubAvail] = useState(null);

  const load = async () => {
    try {
      const r = await api.get(`/events/${id}`);
      setEv(r.data);
    } catch {
      toast.error("No se pudo cargar el evento");
      navigate("/eventos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api.get("/categories").then((r) => setCategories(r.data)).catch(() => {});
    api.get("/materials").then((r) => setAllMaterials(r.data)).catch(() => {});
    // eslint-disable-next-line
  }, [id]);

  const isPrepLocked = ev?.prep_status === "preparado";
  const isClosed = ev?.status === "cerrado";
  const prepChecks = useMemo(() => new Set(ev?.prep_checks || []), [ev]);

  // Flatten unit rows for counter
  const allUnitRows = useMemo(() => {
    if (!ev) return [];
    return (ev.materials || []).flatMap((m) =>
      (m.units || []).map((u) => ({
        material_id: m.material_id, material_name: m.name, material_reference: m.reference,
        category: m.category, unit_id: u.unit_id, unit_reference: u.reference, flightcase: u.flightcase || "",
      }))
    );
  }, [ev]);
  const totalUnits = allUnitRows.length;
  const checkedCount = allUnitRows.filter((r) => prepChecks.has(r.unit_id)).length;

  // ---------- API actions ----------
  const toggleOne = async (unit_id, checked) => {
    if (!canEdit || isPrepLocked) return;
    try {
      const r = await api.post(`/events/${id}/prep/check-unit`, { unit_id, checked });
      setEv(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const toggleBatch = async (unit_ids, checked) => {
    if (!canEdit || isPrepLocked || unit_ids.length === 0) return;
    try {
      const r = await api.post(`/events/${id}/prep/check-batch`, { unit_ids, checked });
      setEv(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const removeUnit = async (material_id, unit_id, reference) => {
    if (!canEdit || isPrepLocked) return;
    if (!window.confirm(`¿Quitar la unidad ${reference} del evento?`)) return;
    try {
      const r = await api.post(`/events/${id}/prep/remove-unit`, { material_id, unit_id });
      setEv(r.data); toast.success("Unidad retirada");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const openSubstitute = (material_id, material_name, old_unit_id, old_reference) => {
    if (!canEdit || isPrepLocked) return;
    setSubCtx({ material_id, material_name, old_unit_id, old_reference });
    setSubPickedMat(null); setSubAvail(null); setSubSearchQ("");
    setSubOpen(true);
  };

  const pickSubMaterial = async (m) => {
    setSubPickedMat(m);
    setSubAvail(null);
    try {
      const r = await api.get(`/events/${id}/availability`, { params: { material_id: m.id } });
      setSubAvail(r.data);
    } catch { toast.error("Error cargando disponibilidad"); }
  };

  const confirmSubstitute = async (new_unit_id) => {
    if (!subCtx || !subPickedMat) return;
    try {
      const r = await api.post(`/events/${id}/prep/substitute`, {
        material_id: subCtx.material_id,
        old_unit_id: subCtx.old_unit_id,
        new_unit_id,
        new_material_id: subPickedMat.id,
      });
      setEv(r.data);
      setSubOpen(false); setSubCtx(null); setSubPickedMat(null); setSubAvail(null);
      toast.success("Unidad sustituida");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const lockPrep = async () => {
    try {
      const r = await api.post(`/events/${id}/prep/lock`);
      setEv(r.data); toast.success("Material bloqueado por Almacén");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };
  const unlockPrep = async () => {
    try {
      const r = await api.post(`/events/${id}/prep/unlock`);
      setEv(r.data); toast.success("Desbloqueado, ya se puede modificar");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const markAll = async () => {
    if (!canEdit || isPrepLocked) return;
    const allIds = (ev?.materials || []).flatMap((m) => (m.units || []).map((u) => u.unit_id));
    const pending = allIds.filter((uid) => !prepChecks.has(uid));
    if (pending.length === 0) { toast.info("Ya está todo marcado"); return; }
    if (!window.confirm(`¿Marcar como preparadas las ${pending.length} unidades restantes?`)) return;
    try {
      const r = await api.post(`/events/${id}/prep/check-batch`, { unit_ids: pending, checked: true });
      setEv(r.data); toast.success(`${pending.length} unidades marcadas`);
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const downloadPrepPDF = () => {
    const token = localStorage.getItem("auth_token");
    const url = `${API}/events/${id}/export-prep`;
    // Use fetch with auth header → blob → trigger download (axios baseURL not needed; we want raw fetch for blob)
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error("Error " + r.status); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = `preparacion_${(ev.reference || ev.name || "evento").replace(/\s+/g, "_")}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(objUrl);
      })
      .catch(() => toast.error("Error descargando PDF"));
  };

  // ---------- Render helpers ----------
  if (loading || !ev) {
    return <div style={{ padding: 40, color: "var(--ink-mute)" }}>Cargando…</div>;
  }

  // Group materials by category, respecting category order from /categories
  const catMap = new Map(categories.map((c) => [c.key, c]));
  const grouped = {};
  (ev.materials || []).forEach((m) => { (grouped[m.category] ||= []).push(m); });
  const catOrder = categories.map((c) => c.key).filter((k) => grouped[k]?.length);

  // Filter materials for substitute search (exclude old material to avoid same-material; but allow same too)
  const filteredSubMaterials = allMaterials
    .filter((m) =>
      !subSearchQ ||
      m.name.toLowerCase().includes(subSearchQ.toLowerCase()) ||
      (m.reference || "").toLowerCase().includes(subSearchQ.toLowerCase())
    )
    .slice(0, 50);

  return (
    <div data-testid="event-prepare-page" style={{ maxWidth: 980, margin: "0 auto" }}>
      <Link to={`/eventos/${id}`} style={{ color: "var(--ink-mute)", fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Volver al evento
      </Link>

      {/* Header (PDF-like) */}
      <div className="card-paper" style={{ marginBottom: 18, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", borderBottom: "1px solid var(--ink)", paddingBottom: 12, marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Package size={20} />
              <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--ink-mute)" }}>Hoja de preparación</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{ev.name}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-mute)" }}>
              {ev.client_name || "Sin cliente"}
              {ev.reference && ` · Ref. ${ev.reference}`}
              {ev.location && ` · ${ev.location}`}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, padding: "3px 10px", borderRadius: 999, background: ev.type === "bolo" ? "#fef3c7" : "#e0e7ff", color: ev.type === "bolo" ? "#92400e" : "#3730a3", textTransform: "uppercase", letterSpacing: "0.08em" }}>{ev.type}</span>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>
              {ev.warehouse_out_dt ? `Salida nave: ${fmtDt(ev.warehouse_out_dt)}` : (ev.setup_start_dt ? `Montaje: ${fmtDt(ev.setup_start_dt)}` : "")}
            </div>
            {ev.return_dt && <div style={{ fontSize: 12, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>Devolución: {fmtDt(ev.return_dt)}</div>}
          </div>
        </div>

        {/* Status / lock controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              padding: "8px 14px", borderRadius: 999,
              background: isPrepLocked ? "#dcfce7" : "#f5f5f4",
              border: `1px solid ${isPrepLocked ? "#86efac" : "var(--line)"}`,
              fontWeight: 700, fontSize: 13, color: isPrepLocked ? "#166534" : "var(--ink)",
              display: "inline-flex", alignItems: "center", gap: 6,
            }} data-testid="prep-status-pill">
              {isPrepLocked ? <Lock size={14} /> : <Package size={14} />}
              {isPrepLocked ? "PREPARADO Y BLOQUEADO" : "PENDIENTE DE PREPARAR"}
            </div>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 600, color: checkedCount === totalUnits && totalUnits > 0 ? "var(--good)" : "var(--ink-mute)" }} data-testid="prep-counter">
              {checkedCount}/{totalUnits} unidades
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(isAlmacen || isProductor) && (
              <Button variant="outline" onClick={downloadPrepPDF} data-testid="prep-pdf-btn" title="Imprimir hoja para tachar a mano">
                <FileDown size={14} /> Imprimir hoja
              </Button>
            )}
            {canEdit && !isClosed && !isPrepLocked && totalUnits > 0 && checkedCount < totalUnits && (
              <Button variant="outline" onClick={markAll} data-testid="prep-mark-all-btn" title="Marcar todas las unidades como preparadas">
                <CheckSquare size={14} /> Marcar todo
              </Button>
            )}
            {canEdit && !isClosed && !isPrepLocked && totalUnits > 0 && (
              <Button
                onClick={lockPrep}
                disabled={checkedCount < totalUnits}
                style={{ background: checkedCount === totalUnits ? "var(--good)" : "#a8a29e" }}
                data-testid="prep-lock-btn"
              >
                <Lock size={14} /> Marcar listo y bloquear
              </Button>
            )}
            {canEdit && isPrepLocked && (
              <Button onClick={unlockPrep} variant="outline" data-testid="prep-unlock-btn">
                <Unlock size={14} /> Desbloquear
              </Button>
            )}
            {!canEdit && (
              <span style={{ fontSize: 11, color: "var(--ink-mute)", fontStyle: "italic" }}>
                {isProductor ? "Solo lectura · solo Almacén edita la preparación" : "Solo lectura"}
              </span>
            )}
          </div>
        </div>
        {isPrepLocked && ev.prep_locked_by_name && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>
            Preparado por {ev.prep_locked_by_name} · {ev.prep_locked_at ? new Date(ev.prep_locked_at).toLocaleString("es-ES") : ""}
          </div>
        )}
      </div>

      {/* Material list — PDF-like layout */}
      <div className="card-paper" style={{ padding: 24 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#b45309" }}>
          Material bloqueado del stock
        </h3>
        <div style={{ borderBottom: "1px solid #b45309", marginBottom: 18 }} />

        {catOrder.length === 0 && (
          <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>Sin material asignado al evento.</p>
        )}

        {catOrder.map((catKey) => {
          const cat = catMap.get(catKey) || { key: catKey, label: catKey, has_unit_refs: true };
          const mats = grouped[catKey] || [];
          return (
            <div key={catKey} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", borderBottom: "1px dashed var(--line)", paddingBottom: 4, marginBottom: 10 }}>
                {cat.label || catKey}
              </div>

              {cat.has_unit_refs !== false ? (
                // ----- Categories with unit refs: list each unit -----
                mats.map((m) => (
                  <MaterialBlock
                    key={m.material_id}
                    material={m}
                    prepChecks={prepChecks}
                    canEdit={canEdit && !isPrepLocked && !isClosed}
                    onToggleOne={toggleOne}
                    onToggleAll={toggleBatch}
                    onSubstitute={(uid, uref) => openSubstitute(m.material_id, m.name, uid, uref)}
                    onRemove={(uid, uref) => removeUnit(m.material_id, uid, uref)}
                  />
                ))
              ) : (
                // ----- Categories without unit refs (cables): group by flightcase -----
                <CablesByFlightcase
                  materials={mats}
                  prepChecks={prepChecks}
                  canEdit={canEdit && !isPrepLocked && !isClosed}
                  onToggleOne={toggleOne}
                  onToggleAll={toggleBatch}
                  onSubstitute={openSubstitute}
                  onRemove={removeUnit}
                />
              )}
            </div>
          );
        })}

        {/* Rentals (read-only here, but visible to mimic PDF) */}
        {(ev.rentals || []).length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#b45309", margin: "0 0 4px" }}>
              Material de alquiler externo
            </h3>
            <div style={{ borderBottom: "1px solid #b45309", marginBottom: 10 }} />
            {ev.rentals.map((r) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                <div>{r.name}{r.notes && <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{r.notes}</div>}</div>
                <div style={{ color: "var(--ink-mute)" }}>{r.provider_name || "—"}</div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", textAlign: "right" }}>x{r.quantity}</div>
              </div>
            ))}
          </div>
        )}

        {/* Activity log */}
        {(ev.prep_log || []).length > 0 && (
          <details style={{ marginTop: 24, paddingTop: 14, borderTop: "1px dashed var(--line)" }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace" }}>Registro de cambios ({ev.prep_log.length})</summary>
            <div style={{ marginTop: 10, maxHeight: 280, overflowY: "auto", fontSize: 12 }}>
              {[...ev.prep_log].reverse().map((l) => (
                <div key={l.id} style={{ display: "grid", gridTemplateColumns: "100px 1fr 170px", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--line)", color: "var(--ink-soft)" }}>
                  <span style={{ fontWeight: 600, fontFamily: "JetBrains Mono, monospace", fontSize: 10, textTransform: "uppercase", color: l.action === "lock" ? "var(--good)" : l.action === "unlock" ? "var(--warn)" : l.action === "substitute" ? "#3730a3" : l.action === "remove_unit" ? "var(--bad)" : "var(--ink-mute)" }}>{l.action}</span>
                  <span>
                    {l.action === "substitute" && <>{l.old_reference} → {l.new_reference}</>}
                    {l.action === "remove_unit" && <>{l.reference}</>}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)", textAlign: "right" }}>{l.by_user_name} · {new Date(l.at).toLocaleString("es-ES")}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Substitute modal: full-warehouse search */}
      <Dialog open={subOpen} onOpenChange={(o) => { setSubOpen(o); if (!o) { setSubCtx(null); setSubPickedMat(null); setSubAvail(null); setSubSearchQ(""); } }}>
        <DialogContent style={{ maxWidth: 680 }} data-testid="substitute-dialog">
          <DialogHeader>
            <DialogTitle>
              Sustituir <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)" }}>{subCtx?.old_reference}</span>
              <span style={{ fontSize: 12, color: "var(--ink-mute)", marginLeft: 8, fontWeight: 400 }}>({subCtx?.material_name})</span>
            </DialogTitle>
          </DialogHeader>

          {!subPickedMat ? (
            <>
              <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>
                Busca cualquier material del almacén para sustituir esta unidad:
              </p>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "var(--ink-mute)" }} />
                <Input
                  data-testid="sub-search-input"
                  placeholder="Nombre o referencia…"
                  value={subSearchQ}
                  onChange={(e) => setSubSearchQ(e.target.value)}
                  style={{ paddingLeft: 36 }}
                  autoFocus
                />
              </div>
              <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                {filteredSubMaterials.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pickSubMaterial(m)}
                    data-testid={`sub-mat-${m.reference}`}
                    className="row-hover"
                    style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 14px", borderBottom: "1px solid var(--line)", width: "100%", textAlign: "left", background: "none", border: "none", borderLeft: "none", borderRight: "none", borderTop: "none", cursor: "pointer" }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)", fontWeight: 600, marginRight: 8 }}>{m.reference}</span>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{m.category} · {m.quantity} unidades</div>
                  </button>
                ))}
                {filteredSubMaterials.length === 0 && <p style={{ padding: 20, color: "var(--ink-mute)", textAlign: "center" }}>Sin resultados</p>}
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: 12, border: "1.5px solid var(--accent)", borderRadius: 8, background: "#fffbeb", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>{subPickedMat.reference}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{subPickedMat.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{subPickedMat.category}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setSubPickedMat(null); setSubAvail(null); }}>cambiar material</Button>
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>Elige una unidad disponible:</p>
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
                {!subAvail && <div style={{ padding: 16, color: "var(--ink-mute)" }}>Cargando…</div>}
                {subAvail && subAvail.units.length === 0 && <div style={{ padding: 16, color: "var(--ink-mute)" }}>Este material no tiene unidades.</div>}
                {subAvail && subAvail.units.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => confirmSubstitute(u.id)}
                    disabled={!u.available}
                    data-testid={`sub-unit-${u.reference}`}
                    style={{ display: "grid", gridTemplateColumns: "150px 1fr 110px", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--line)", background: "#fff", border: "none", borderLeft: "none", borderRight: "none", borderTop: "none", width: "100%", textAlign: "left", cursor: u.available ? "pointer" : "not-allowed", opacity: u.available ? 1 : 0.5 }}
                  >
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{u.reference}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>{(u.subitems || []).length > 0 ? `${u.subitems.length} subítem(s)` : ""}</span>
                    <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", color: u.available ? "var(--good)" : "var(--bad)", textAlign: "right" }}>
                      {u.available ? "DISPONIBLE" : (u.reason || "no disp.")}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSubOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Material block (categories with unit refs) ----------
function MaterialBlock({ material, prepChecks, canEdit, onToggleOne, onToggleAll, onSubstitute, onRemove }) {
  const units = material.units || [];
  const checkedIds = units.filter((u) => prepChecks.has(u.unit_id)).map((u) => u.unit_id);
  const allChecked = units.length > 0 && checkedIds.length === units.length;
  const someChecked = checkedIds.length > 0 && !allChecked;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", marginBottom: 4 }}>
        {units.length > 1 && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: canEdit ? "pointer" : "not-allowed" }} title="Marcar/desmarcar todas">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = someChecked; }}
              onChange={() => onToggleAll(units.map((u) => u.unit_id), !allChecked)}
              disabled={!canEdit}
              data-testid={`prep-all-${material.reference || material.material_id}`}
              style={{ width: 16, height: 16 }}
            />
          </label>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {material.reference && <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)", marginRight: 8 }}>{material.reference}</span>}
            {material.name}
            <span style={{ marginLeft: 8, color: "var(--ink-mute)", fontWeight: 400, fontSize: 12 }}>×{units.length}</span>
          </div>
        </div>
        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: allChecked ? "var(--good)" : "var(--ink-mute)" }}>
          {checkedIds.length}/{units.length}
        </span>
      </div>

      <div style={{ paddingLeft: units.length > 1 ? 28 : 0 }}>
        {units.map((u) => {
          const checked = prepChecks.has(u.unit_id);
          return (
            <div
              key={u.unit_id}
              className="row-hover"
              style={{
                display: "grid",
                gridTemplateColumns: "26px 130px 1fr 110px 40px",
                gap: 8, padding: "6px 4px",
                borderBottom: "1px solid var(--line)", alignItems: "center",
                background: checked ? "#dcfce7" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!canEdit}
                onChange={() => onToggleOne(u.unit_id, !checked)}
                data-testid={`prep-check-${u.reference}`}
                style={{ width: 16, height: 16, cursor: canEdit ? "pointer" : "not-allowed" }}
              />
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>{u.reference}</span>
              <div style={{ fontSize: 12, color: checked ? "var(--ink-mute)" : "inherit", textDecoration: checked ? "line-through" : "none" }}>
                {(u.subitems || []).length > 0 && (
                  <span style={{ fontSize: 10, color: "var(--ink-mute)" }}>{u.subitems.length} subítem(s)</span>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => onSubstitute(u.unit_id, u.reference)} title="Sustituir por otro material/unidad" data-testid={`prep-sub-${u.reference}`}>
                    <RefreshCw size={12} /> Sustituir
                  </Button>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                {canEdit && (
                  <Button size="icon" variant="ghost" onClick={() => onRemove(u.unit_id, u.reference)} title="Quitar unidad del evento">
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Cables grouped by flightcase ----------
function CablesByFlightcase({ materials, prepChecks, canEdit, onToggleOne, onToggleAll, onSubstitute, onRemove }) {
  // Build groups: {fcName: [{material, unit}, …]}
  const groups = {};
  materials.forEach((m) => {
    (m.units || []).forEach((u) => {
      const fc = u.flightcase || "";
      (groups[fc] ||= []).push({ m, u });
    });
  });
  const fcKeys = Object.keys(groups).sort((a, b) => {
    if (a === "" && b !== "") return 1;
    if (b === "" && a !== "") return -1;
    return a.localeCompare(b);
  });

  return (
    <div>
      {fcKeys.map((fc) => {
        const rows = groups[fc];
        const fcLabel = fc || "Sin flightcase";
        const allUids = rows.map((r) => r.u.unit_id);
        const checkedInFc = allUids.filter((uid) => prepChecks.has(uid));
        const allChecked = allUids.length > 0 && checkedInFc.length === allUids.length;
        const someChecked = checkedInFc.length > 0 && !allChecked;

        return (
          <div key={fc || "_none"} style={{ marginBottom: 14, border: "1px solid var(--line)", borderRadius: 8, padding: 10, background: "#fafaf9" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              {allUids.length > 1 && (
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={() => onToggleAll(allUids, !allChecked)}
                  disabled={!canEdit}
                  data-testid={`prep-fc-all-${fcLabel}`}
                  style={{ width: 16, height: 16 }}
                  title="Marcar/desmarcar todo el flightcase"
                />
              )}
              <div style={{ flex: 1, fontWeight: 700, color: "#3730a3", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <CheckCheck size={14} /> {fcLabel}
              </div>
              <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: allChecked ? "var(--good)" : "var(--ink-mute)" }}>
                {checkedInFc.length}/{allUids.length}
              </span>
            </div>

            {/* Aggregate per material inside flightcase */}
            {(() => {
              const matAgg = new Map();
              rows.forEach(({ m, u }) => {
                if (!matAgg.has(m.material_id)) matAgg.set(m.material_id, { m, units: [] });
                matAgg.get(m.material_id).units.push(u);
              });
              return Array.from(matAgg.values()).map(({ m, units }) => {
                const checkedIds = units.filter((u) => prepChecks.has(u.unit_id)).map((u) => u.unit_id);
                const matAllChecked = units.length > 0 && checkedIds.length === units.length;
                const matSome = checkedIds.length > 0 && !matAllChecked;
                return (
                  <div key={m.material_id} style={{ paddingLeft: 26, marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                      {units.length > 1 && (
                        <input
                          type="checkbox"
                          checked={matAllChecked}
                          ref={(el) => { if (el) el.indeterminate = matSome; }}
                          onChange={() => onToggleAll(units.map((u) => u.unit_id), !matAllChecked)}
                          disabled={!canEdit}
                          data-testid={`prep-mat-all-${m.reference || m.material_id}`}
                          style={{ width: 14, height: 14 }}
                        />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 500 }}>
                        {m.reference && <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--accent)", marginRight: 6, fontSize: 11 }}>{m.reference}</span>}
                        {m.name}
                        <span style={{ marginLeft: 6, color: "var(--ink-mute)", fontWeight: 400, fontSize: 12 }}>×{units.length}</span>
                      </span>
                    </div>
                    {units.map((u) => {
                      const ch = prepChecks.has(u.unit_id);
                      return (
                        <div key={u.unit_id} style={{ display: "grid", gridTemplateColumns: "26px 120px 1fr 110px 40px", gap: 8, paddingLeft: units.length > 1 ? 22 : 0, padding: "4px 4px", borderBottom: "1px solid var(--line)", alignItems: "center", background: ch ? "#dcfce7" : "transparent" }}>
                          <input
                            type="checkbox"
                            checked={ch}
                            disabled={!canEdit}
                            onChange={() => onToggleOne(u.unit_id, !ch)}
                            data-testid={`prep-check-${u.reference}`}
                            style={{ width: 14, height: 14, cursor: canEdit ? "pointer" : "not-allowed" }}
                          />
                          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--accent)" }}>{u.reference}</span>
                          <span />
                          <div style={{ textAlign: "right" }}>
                            {canEdit && (
                              <Button size="sm" variant="ghost" onClick={() => onSubstitute(m.material_id, m.name, u.unit_id, u.reference)} title="Sustituir">
                                <RefreshCw size={12} />
                              </Button>
                            )}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            {canEdit && (
                              <Button size="icon" variant="ghost" onClick={() => onRemove(m.material_id, u.unit_id, u.reference)} title="Quitar">
                                <Trash2 size={12} />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        );
      })}
    </div>
  );
}
