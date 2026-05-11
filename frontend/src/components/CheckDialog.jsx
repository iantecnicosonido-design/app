import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { toast } from "sonner";

/**
 * Internal check (after return). Only Almacén/Productor sees this.
 * Each returned item gets OK or NO OK. NO OK → broken + incident.
 * Items declared MISSING on return are shown in read-only state.
 */
export function CheckDialog({ open, onClose, event, onSaved }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  // Build review list from event.return_info.items, mapping back to original material info
  const seededItems = useMemo(() => {
    if (!event) return [];
    const ri = event.return_info || {};
    const matMap = new Map();
    (event.materials || []).forEach((m) => {
      (m.units || []).forEach((u) => matMap.set(u.unit_id, { name: m.name, category: m.category, reference: u.reference, material_id: m.material_id }));
    });
    const rentMap = new Map();
    (event.rentals || []).forEach((r) => rentMap.set(r.id, { name: r.name, category: "EXTERNO", reference: r.provider_name || "—", quantity: r.quantity }));
    return (ri.items || []).map((it) => {
      const meta = it.kind === "rental" ? rentMap.get(it.id) : matMap.get(it.id);
      return {
        id: it.id, kind: it.kind, material_id: it.material_id || meta?.material_id || null,
        material_name: meta?.name || "—", reference: meta?.reference || "—",
        category: meta?.category || "—", quantity: meta?.quantity,
        return_status: it.status,            // "returned" or "missing"
        check_status: it.status === "returned" ? "ok" : "missing",
        note: it.note || "",
      };
    });
  }, [event]);

  useEffect(() => {
    if (open) setItems(seededItems);
  }, [open, seededItems]);

  const setItemStatus = (id, status) => {
    setItems((arr) => arr.map((it) => it.id === id && it.return_status === "returned" ? { ...it, check_status: status } : it));
  };
  const setItemNote = (id, note) => {
    setItems((arr) => arr.map((it) => it.id === id ? { ...it, note } : it));
  };

  const counts = items.reduce((acc, it) => {
    const k = it.return_status === "missing" ? "missing" : it.check_status;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const submit = async () => {
    setBusy(true);
    try {
      const payload = {
        items: items
          .filter((it) => it.return_status === "returned")
          .map((it) => ({
            id: it.id, kind: it.kind, material_id: it.material_id || null,
            status: it.check_status, note: it.note || "",
          })),
      };
      await api.post(`/events/${event.id}/check`, payload);
      toast.success("Comprobación registrada");
      onSaved && onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error registrando comprobación");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ maxWidth: 760, maxHeight: "92vh", overflowY: "auto" }} data-testid="check-dialog">
        <DialogHeader><DialogTitle>Comprobación del material devuelto</DialogTitle></DialogHeader>
        <p style={{ fontSize: 13 }}>
          Revisa los elementos devueltos y márcalos como <b>OK</b> o <b>NO OK</b>.
          Los marcados como NO OK se marcarán como averiados y abrirán una incidencia automáticamente.
        </p>
        <div style={{ display: "flex", gap: 14, fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)" }}>
          <span><b style={{ color: "#166534" }}>OK:</b> {counts.ok || 0}</span>
          <span><b style={{ color: "#991b1b" }}>NO OK:</b> {counts.nok || 0}</span>
          <span><b style={{ color: "#b45309" }}>FALTA (informativo):</b> {counts.missing || 0}</span>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginTop: 8 }}>
          {items.length === 0 && <p style={{ padding: 14, color: "var(--ink-mute)" }}>No hay items para comprobar.</p>}
          {items.map((it) => {
            const isMissing = it.return_status === "missing";
            return (
              <div key={it.id} style={{
                padding: "10px 12px", borderBottom: "1px solid var(--line)",
                background: isMissing ? "#fef3c7" : (it.check_status === "nok" ? "#fef2f2" : "#fff"),
                opacity: isMissing ? 0.85 : 1,
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 8, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{it.material_name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>
                      {it.category} · {it.reference} {it.kind === "rental" && it.quantity ? `· x${it.quantity}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {isMissing ? (
                      <span style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, color: "#b45309", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 4, textTransform: "uppercase", textAlign: "center", flex: 1 }}>
                        FALTA (no revisable)
                      </span>
                    ) : (
                      [["ok", "OK", "#16a34a"], ["nok", "NO OK", "#dc2626"]].map(([s, label, color]) => (
                        <button
                          key={s}
                          onClick={() => setItemStatus(it.id, s)}
                          data-testid={`check-${it.id}-${s}`}
                          style={{
                            flex: 1, padding: "5px 6px", borderRadius: 4, border: "1px solid",
                            borderColor: it.check_status === s ? "transparent" : "var(--line)",
                            background: it.check_status === s ? color : "#fff",
                            color: it.check_status === s ? "#fff" : "var(--ink)",
                            fontSize: 11, fontWeight: 600, cursor: "pointer", textTransform: "uppercase",
                          }}
                        >
                          {label}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                {!isMissing && it.check_status === "nok" && (
                  <Input
                    placeholder="Nota / detalle del daño (opcional)"
                    value={it.note} onChange={(e) => setItemNote(it.id, e.target.value)}
                    style={{ marginTop: 6, fontSize: 12 }}
                    data-testid={`check-${it.id}-note`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy} style={{ background: "var(--accent)" }} data-testid="check-submit">
            {busy ? "Guardando…" : "Finalizar comprobación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
