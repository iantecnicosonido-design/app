import { useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Plus, FileImage, X } from "lucide-react";
import { toast } from "sonner";
import { SignaturePad, dataUrlToBlob } from "./SignaturePad";

const LEGAL = `El cliente declara recibir el material en correctas condiciones y se compromete a hacer un uso adecuado y responsable del mismo durante todo el periodo de alquiler.

El cliente será el único responsable de cualquier pérdida, robo, daño o deterioro ocasionado al material mientras este permanezca bajo su posesión o custodia. En caso de daño, el cliente deberá asumir el importe correspondiente a la reparación del material afectado. Si la reparación no fuese posible, el cliente deberá abonar el valor actual de mercado del equipo o elemento dañado o extraviado.

La firma del presente documento implica la aceptación expresa de estas condiciones.`;

export function DeliveryDialog({ open, onClose, eventId, onSaved }) {
  const [form, setForm] = useState({
    has_deposit: false, deposit_amount: "",
    payment_method: "efectivo", client_email: "",
    legal_accepted: false,
  });
  const [sigDataUrl, setSigDataUrl] = useState(null);
  const [dniFront, setDniFront] = useState(null);
  const [dniBack, setDniBack] = useState(null);
  const [busy, setBusy] = useState(false);

  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    return { file_id: r.data.id, name: r.data.name, content_type: r.data.content_type };
  };

  const pickDni = async (which, fileList) => {
    if (!fileList || !fileList[0]) return;
    try {
      const f = await uploadFile(fileList[0]);
      if (which === "front") setDniFront(f);
      else setDniBack(f);
    } catch { toast.error("Error subiendo DNI"); }
  };

  const submit = async () => {
    if (!form.legal_accepted) { toast.error("Debes aceptar el aviso legal"); return; }
    if (form.has_deposit && (!form.deposit_amount || parseFloat(form.deposit_amount) < 0)) {
      toast.error("Importe de fianza inválido"); return;
    }
    if (!sigDataUrl) { toast.error("Falta la firma del cliente"); return; }
    setBusy(true);
    try {
      // Upload signature
      const blob = dataUrlToBlob(sigDataUrl);
      const sigFd = new FormData();
      sigFd.append("file", new File([blob], "firma_entrega.png", { type: "image/png" }));
      const sigRes = await api.post("/upload", sigFd, { headers: { "Content-Type": "multipart/form-data" } });
      const payload = {
        has_deposit: form.has_deposit,
        deposit_amount: form.has_deposit ? parseFloat(form.deposit_amount || 0) : 0,
        payment_method: form.payment_method,
        legal_accepted: true,
        client_email: form.client_email.trim() || null,
        signature_file_id: sigRes.data.id,
        dni_front_file_id: dniFront?.file_id || null,
        dni_back_file_id: dniBack?.file_id || null,
      };
      await api.post(`/events/${eventId}/delivery`, payload);
      toast.success("Entrega registrada");
      onSaved && onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error registrando entrega");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ maxWidth: 720, maxHeight: "92vh", overflowY: "auto" }} data-testid="delivery-dialog">
        <DialogHeader><DialogTitle>Entrega de material (alquiler)</DialogTitle></DialogHeader>

        <div style={{ display: "grid", gap: 14 }}>
          {/* Deposit */}
          <Section title="Fianza">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox" checked={form.has_deposit}
                onChange={(e) => setForm({ ...form, has_deposit: e.target.checked })}
                data-testid="delivery-has-deposit"
              />
              ¿Se recoge fianza?
            </label>
            {form.has_deposit && (
              <Input
                type="number" step="0.01" min="0" placeholder="Importe en EUR"
                value={form.deposit_amount}
                onChange={(e) => setForm({ ...form, deposit_amount: e.target.value })}
                style={{ marginTop: 8, maxWidth: 220 }}
                data-testid="delivery-deposit-amount"
              />
            )}
          </Section>

          {/* DNI */}
          <Section title="DNI del cliente (anverso + reverso)">
            <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>Solo visible para Almacén y Productores. No se incluye en el PDF.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <DniBox label="Anverso" file={dniFront} onPick={(fl) => pickDni("front", fl)} onClear={() => setDniFront(null)} testId="dni-front" />
              <DniBox label="Reverso" file={dniBack} onPick={(fl) => pickDni("back", fl)} onClear={() => setDniBack(null)} testId="dni-back" />
            </div>
          </Section>

          {/* Legal notice */}
          <Section title="Aviso legal">
            <div style={{ background: "#fafaf9", border: "1px solid var(--line)", borderRadius: 6, padding: 12, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 240, overflowY: "auto", lineHeight: 1.6 }}>{LEGAL}</div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer" }}>
              <input
                type="checkbox" checked={form.legal_accepted}
                onChange={(e) => setForm({ ...form, legal_accepted: e.target.checked })}
                data-testid="delivery-legal-accept"
              />
              <span style={{ fontWeight: 600 }}>He leído y acepto el aviso legal</span>
            </label>
          </Section>

          {/* Payment method */}
          <Section title="Método de pago">
            <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
              <SelectTrigger data-testid="delivery-payment" style={{ maxWidth: 280 }}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="efectivo">Efectivo</SelectItem>
                <SelectItem value="tarjeta">Tarjeta</SelectItem>
                <SelectItem value="transferencia">Transferencia bancaria</SelectItem>
              </SelectContent>
            </Select>
          </Section>

          {/* Client email (optional) */}
          <Section title="Email del cliente (opcional)">
            <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 6 }}>Si lo indicas, el PDF de entrega se enviará automáticamente.</p>
            <Input type="email" value={form.client_email} onChange={(e) => setForm({ ...form, client_email: e.target.value })} placeholder="cliente@example.com" data-testid="delivery-email" style={{ maxWidth: 360 }} />
          </Section>

          {/* Signature */}
          <Section title="Firma del cliente">
            <SignaturePad onChange={setSigDataUrl} testId="delivery-sig" />
          </Section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || !form.legal_accepted || !sigDataUrl} style={{ background: "var(--accent)" }} data-testid="delivery-submit">
            {busy ? "Guardando…" : "Registrar entrega"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ paddingBottom: 10, borderBottom: "1px dashed var(--line)" }}>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function DniBox({ label, file, onPick, onClear, testId }) {
  return (
    <div style={{ position: "relative", padding: 10, border: "1.5px dashed var(--line)", borderRadius: 6, minHeight: 90 }}>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 8 }}>{label}</div>
      {file ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#166534", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <FileImage size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {file.name}
          </span>
          <Button size="icon" variant="ghost" onClick={onClear} data-testid={`${testId}-clear`}><X size={14} /></Button>
        </div>
      ) : (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "var(--accent)", fontWeight: 600 }}>
          <Plus size={14} /> Subir / Cámara
          <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => onPick(e.target.files)} data-testid={testId} />
        </label>
      )}
    </div>
  );
}
