import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Copy, AlertTriangle, Check, X, RefreshCw } from "lucide-react";
import SearchSelect from "./SearchSelect";
import { toast } from "sonner";

export default function DuplicateMaterialDialog({ open, onOpenChange, eventId, eventName, allMaterials, onApplied }) {
  const [step, setStep] = useState("pick");
  const [candidates, setCandidates] = useState([]);
  const [sourceId, setSourceId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [resolutions, setResolutions] = useState({}); // { material_id: {action, quantity, substitute_with} }
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !eventName) return;
    setStep("pick"); setSourceId(null); setPreview(null); setResolutions({});
    api.get("/events/similar-by-name", { params: { name: eventName, exclude: eventId } })
      .then((r) => setCandidates(r.data || []))
      .catch(() => setCandidates([]));
  }, [open, eventName, eventId]);

  const loadPreview = async (sid) => {
    setSourceId(sid); setLoading(true);
    try {
      const r = await api.get(`/events/${eventId}/duplicate-preview`, { params: { source: sid } });
      setPreview(r.data);
      const init = {};
      (r.data.items || []).forEach((it) => {
        init[it.material_id] = {
          action: it.can_fully_copy ? "copy" : "substitute",
          quantity: it.needed_qty,
          substitute_with: null,
        };
      });
      setResolutions(init);
      setStep("resolve");
    } catch { toast.error("Error cargando vista previa"); }
    finally { setLoading(false); }
  };

  const updateRes = (mid, patch) => setResolutions((s) => ({ ...s, [mid]: { ...s[mid], ...patch } }));

  const apply = async () => {
    setLoading(true);
    const items = (preview.items || []).map((it) => ({
      material_id: it.material_id,
      action: resolutions[it.material_id]?.action || "copy",
      quantity: Number(resolutions[it.material_id]?.quantity || it.needed_qty),
      substitute_with: resolutions[it.material_id]?.substitute_with || null,
    }));
    try {
      const r = await api.post(`/events/${eventId}/duplicate-from`, { source_event_id: sourceId, items });
      const fail = (r.data.results || []).filter((x) => !x.ok);
      if (fail.length === 0) toast.success("Material duplicado");
      else toast.error(`Aplicado parcial. ${fail.length} ítem(s) fallaron.`);
      onApplied?.(r.data.event);
      onOpenChange(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 900 }} data-testid="duplicate-dialog">
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Copy size={18} /> Copiar material de evento anterior · {eventName}
          </DialogTitle>
        </DialogHeader>

        {step === "pick" && (
          <div>
            {candidates.length === 0 ? (
              <p style={{ color: "var(--ink-mute)", fontSize: 14, padding: 20 }}>
                No hay eventos anteriores con el mismo nombre y material asignado.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>Selecciona el evento de origen:</p>
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => loadPreview(c.id)}
                    disabled={loading}
                    data-testid={`source-${c.id}`}
                    style={{
                      textAlign: "left", padding: "12px 16px", border: "1px solid var(--line)",
                      borderRadius: 8, background: "#fff", cursor: "pointer",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {c.event_date} · {c.type} · {c.client_name || "sin cliente"}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontFamily: "JetBrains Mono, monospace" }}>
                      {c.units_count} unidades
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "resolve" && preview && (
          <div style={{ display: "grid", gap: 6, maxHeight: 480, overflowY: "auto" }}>
            <p style={{ fontSize: 13, color: "var(--ink-mute)", margin: 0 }}>
              Desde <b>{preview.source_event.name}</b>. Revisa cada material; los marcados en rojo no tienen stock disponible.
            </p>
            {preview.items.map((it) => {
              const res = resolutions[it.material_id] || {};
              const isMissing = !it.can_fully_copy;
              return (
                <div
                  key={it.material_id}
                  style={{
                    padding: 12, border: "1px solid var(--line)", borderRadius: 8,
                    background: res.action === "skip" ? "#fafafa" : (isMissing ? "#fef2f2" : "#fff"),
                    opacity: res.action === "skip" ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        {isMissing && <AlertTriangle size={14} color="#b91c1c" />}
                        {it.name}
                        <span style={{ fontSize: 11, color: "var(--accent)", fontFamily: "JetBrains Mono, monospace" }}>{it.reference}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
                        Necesita {it.needed_qty} · Disponible {it.available_now}
                        {isMissing && <b style={{ color: "#b91c1c" }}> · Faltan {it.missing}</b>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button size="sm" variant={res.action === "copy" && !isMissing ? "default" : "outline"} disabled={isMissing} onClick={() => updateRes(it.material_id, { action: "copy", substitute_with: null, quantity: it.needed_qty })} title={isMissing ? "Sin stock" : "Copiar"}>
                        <Check size={13} />
                      </Button>
                      <Button size="sm" variant={res.action === "substitute" ? "default" : "outline"} onClick={() => updateRes(it.material_id, { action: "substitute" })} style={res.action === "substitute" ? { background: "#b45309" } : {}}>
                        <RefreshCw size={13} />
                      </Button>
                      <Button size="sm" variant={res.action === "skip" ? "default" : "outline"} onClick={() => updateRes(it.material_id, { action: "skip" })} style={res.action === "skip" ? { background: "#7f1d1d" } : {}}>
                        <X size={13} />
                      </Button>
                    </div>
                  </div>
                  {res.action === "substitute" && (
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 90px", gap: 8 }}>
                      <SearchSelect
                        items={allMaterials.filter((m) => m.id !== it.material_id).map((m) => ({ value: m.id, label: `${m.reference} · ${m.name}` }))}
                        value={res.substitute_with || ""}
                        onChange={(v) => updateRes(it.material_id, { substitute_with: v })}
                        placeholder="Buscar sustituto..."
                      />
                      <Input type="number" min={1} value={res.quantity || 1} onChange={(e) => updateRes(it.material_id, { quantity: Math.max(1, +e.target.value || 1) })} />
                    </div>
                  )}
                  {res.action === "copy" && !isMissing && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>
                      Se bloquearán {it.needed_qty} unidades automáticamente
                    </div>
                  )}
                  {res.action === "skip" && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>
                      No se añadirá
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {step === "resolve" && (
            <>
              <Button variant="outline" onClick={() => setStep("pick")}>Volver</Button>
              <Button onClick={apply} disabled={loading} style={{ background: "var(--good)" }} data-testid="apply-duplicate-btn">
                <Check size={14} /> Aplicar
              </Button>
            </>
          )}
          {step === "pick" && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
