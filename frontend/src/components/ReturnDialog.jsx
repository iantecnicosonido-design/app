import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { toast } from "sonner";
import { SignaturePad, dataUrlToBlob } from "./SignaturePad";

/**
 * Two-step return dialog:
 *  Step 1: client signs ("Edison Rent declares to have received the material…")
 *  Step 2: Almacén marks each item as DEVUELTO or FALTA (missing = lost = broken + incident)
 */
export function ReturnDialog({ open, onClose, event, onSaved }) {
  const [step, setStep] = useState(1);
  const [sigDataUrl, setSigDataUrl] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  const flatItems = useMemo(() => {
    if (!event) return [];
    const list = [];
    (event.materials || []).forEach((m) => {
      (m.units || []).forEach((u) => {
        list.push({
          id: u.unit_id, kind: "unit", material_id: m.material_id,
          material_name: m.name, reference: u.reference, category: m.category,
        });
      });
    });
    (event.rentals || []).forEach((r) => {
      list.push({
        id: r.id, kind: "rental", material_id: null,
        material_name: r.name, reference: r.provider_name || "—",
        category: "EXTERNO", quantity: r.quantity,
      });
    });
    return list;
  }, [event]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSigDataUrl(null);
      setItems(flatItems.map((it) => ({ ...it, status: "returned", note: "" })));
    }
  }, [open, flatItems]);

  const setItemStatus = (id, status) => {
    setItems((arr) => arr.map((it) => it.id === id ? { ...it, status } : it));
  };
  const setItemNote = (id, note) => {
    setItems((arr) => arr.map((it) => it.id === id ? { ...it, note } : it));
  };

  const counts = items.reduce((acc, it) => { acc[it.status] = (acc[it.status] || 0) + 1; return acc; }, {});

  const submit = async () => {
    if (!sigDataUrl) { toast.error("Falta la firma"); return; }
    setBusy(true);
    try {
      const blob = dataUrlToBlob(sigDataUrl);
      const sigFd = new FormData();
      sigFd.append("file", new File([blob], "firma_devolucion.png", { type: "image/png" }));
      const sigRes = await api.post("/upload", sigFd, { headers: { "Content-Type": "multipart/form-data" } });
      const payload = {
        signature_file_id: sigRes.data.id,
        items: items.map((it) => ({
          id: it.id, kind: it.kind, material_id: it.material_id || null,
          status: it.status, note: it.note || "",
        })),
      };
      await api.post(`/events/${event.id}/return`, payload);
      toast.success("Devolución registrada · enviado al cliente");
      onSaved && onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error registrando devolución");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ maxWidth: 760, maxHeight: "92vh", overflowY: "auto" }} data-testid="return-dialog">
        <DialogHeader>
          <DialogTitle>Devolución de material · Paso {step} / 2</DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ fontSize: 13 }}>
              <b>Edison Rent SL</b> declara haber recibido el material en la fecha actual,
              a la espera de la comprobación de su estado. Firma del cliente:
            </p>
            <SignaturePad onChange={setSigDataUrl} testId="return-sig" />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => setStep(2)} disabled={!sigDataUrl} style={{ background: "var(--accent)" }} data-testid="return-next">
                Continuar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ fontSize: 13 }}>
              Marca <b>DEVUELTO</b> o <b>FALTA</b> para cada elemento. Los marcados como FALTA
              se considerarán perdidos y se marcarán como averiados con incidencia automática.
              La revisión OK/NO OK se hace después en <b>Comprobación</b>.
            </p>
            <div style={{ display: "flex", gap: 12, fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)" }}>
              <span><b style={{ color: "#1e3a8a" }}>DEVUELTO:</b> {counts.returned || 0}</span>
              <span><b style={{ color: "#b45309" }}>FALTA:</b> {counts.missing || 0}</span>
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
              {items.length === 0 && <p style={{ padding: 14, color: "var(--ink-mute)" }}>Este alquiler no tiene material registrado.</p>}
              {items.map((it) => (
                <div key={it.id} style={{
                  padding: "10px 12px", borderBottom: "1px solid var(--line)",
                  background: it.status === "missing" ? "#fffbeb" : "#fff",
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 8, alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{it.material_name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace" }}>
                        {it.category} · {it.reference} {it.kind === "rental" && it.quantity ? `· x${it.quantity}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[["returned", "DEVUELTO", "#1e3a8a"], ["missing", "FALTA", "#d97706"]].map(([s, label, color]) => (
                        <button
                          key={s}
                          onClick={() => setItemStatus(it.id, s)}
                          data-testid={`return-${it.id}-${s}`}
                          style={{
                            flex: 1, padding: "5px 6px", borderRadius: 4, border: "1px solid",
                            borderColor: it.status === s ? "transparent" : "var(--line)",
                            background: it.status === s ? color : "#fff",
                            color: it.status === s ? "#fff" : "var(--ink)",
                            fontSize: 11, fontWeight: 600, cursor: "pointer", textTransform: "uppercase",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {it.status === "missing" && (
                    <Input
                      placeholder="Nota / detalle de la falta (opcional)"
                      value={it.note} onChange={(e) => setItemNote(it.id, e.target.value)}
                      style={{ marginTop: 6, fontSize: 12 }}
                      data-testid={`return-${it.id}-note`}
                    />
                  )}
                </div>
              ))}
            </div>
            <DialogFooter style={{ justifyContent: "space-between" }}>
              <Button variant="ghost" onClick={() => setStep(1)}>← Atrás</Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
                <Button onClick={submit} disabled={busy} style={{ background: "var(--accent)" }} data-testid="return-submit">
                  {busy ? "Guardando…" : "Finalizar devolución"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
