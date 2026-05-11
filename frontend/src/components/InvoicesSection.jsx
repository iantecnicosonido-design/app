import { useRef, useState } from "react";
import { api, API } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { FileText, Upload, Trash2, ExternalLink, Euro } from "lucide-react";
import { toast } from "sonner";

export default function InvoicesSection({ event, user, onChanged }) {
  const role = user?.role;
  const isProductor = role === "productor";
  const isAutonomoAssigned = role === "tecnico" && user?.autonomo && (event.assigned_technicians || []).includes(user.id);

  // Productor sees both lists; tech autonomo sees only his upload form + his own invoice
  if (!isProductor && !isAutonomoAssigned) return null;

  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
      {(isProductor || isAutonomoAssigned) && (
        <InvoiceList
          title={isAutonomoAssigned && !isProductor ? "Mi factura" : "Facturas de técnicos autónomos"}
          subtitle={isAutonomoAssigned && !isProductor ? "Tu factura para este evento" : "Subidas por los técnicos autónomos asignados"}
          items={event.tech_invoices || []}
          showTech
          canUpload={isAutonomoAssigned}
          uploadKind="tech"
          eventId={event.id}
          onChanged={onChanged}
          canDeleteItem={(it) => isProductor || it.tech_id === user.id}
          testid="tech-invoices"
        />
      )}
      {isProductor && (
        <InvoiceList
          title="Facturas de alquileres"
          subtitle="Facturas de material alquilado a terceros"
          items={event.rental_invoices || []}
          showProvider
          canUpload
          uploadKind="rental"
          eventId={event.id}
          onChanged={onChanged}
          canDeleteItem={() => true}
          testid="rental-invoices"
        />
      )}
    </div>
  );
}

function InvoiceList({ title, subtitle, items, showTech, showProvider, canUpload, uploadKind, eventId, onChanged, canDeleteItem, testid }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [providerName, setProviderName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  const submit = async () => {
    if (!file) { toast.error("Selecciona un archivo"); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const up = await api.post("/upload", fd);
      const fp = { file_id: up.data.id, name: up.data.name, content_type: up.data.content_type, storage_path: up.data.path, size: up.data.size };
      const body = { file: fp, amount: amount ? parseFloat(amount) : null, notes };
      if (uploadKind === "rental") body.provider_name = providerName;
      const url = uploadKind === "tech" ? `/events/${eventId}/tech-invoices` : `/events/${eventId}/rental-invoices`;
      await api.post(url, body);
      toast.success("Factura subida");
      setOpen(false); setAmount(""); setNotes(""); setProviderName(""); setFile(null);
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
    finally { setBusy(false); }
  };

  const removeItem = async (it) => {
    if (!window.confirm("¿Eliminar esta factura?")) return;
    try {
      const url = uploadKind === "tech" ? `/events/${eventId}/tech-invoices/${it.id}` : `/events/${eventId}/rental-invoices/${it.id}`;
      await api.delete(url);
      toast.success("Eliminada");
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div className="card-paper" data-testid={testid}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <FileText size={16} /> {title}
            <span style={{ fontSize: 11, padding: "2px 8px", background: "#f5f5f4", color: "var(--ink-mute)", borderRadius: 999, fontFamily: "JetBrains Mono, monospace" }}>{items.length}</span>
          </h3>
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>{subtitle}</p>
        </div>
        {canUpload && (
          <Button size="sm" onClick={() => setOpen((v) => !v)} style={{ background: "var(--accent)" }} data-testid={`${testid}-upload-btn`}>
            <Upload size={14} /> {open ? "Cancelar" : "Subir factura"}
          </Button>
        )}
      </div>
      {open && (
        <div style={{ display: "grid", gap: 10, padding: 12, background: "#fafaf9", borderRadius: 6, marginBottom: 10 }}>
          <input type="file" ref={fileRef} onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid={`${testid}-file`} />
          <Input type="number" step="0.01" placeholder="Importe (€)" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`${testid}-amount`} />
          {showProvider && <Input placeholder="Proveedor / empresa" value={providerName} onChange={(e) => setProviderName(e.target.value)} data-testid={`${testid}-provider`} />}
          <Textarea placeholder="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button onClick={submit} disabled={busy || !file} style={{ background: "var(--good)" }} data-testid={`${testid}-submit`}>
            {busy ? "Subiendo..." : "Guardar factura"}
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <p style={{ color: "var(--ink-mute)", fontSize: 13, padding: "8px 0" }}>Sin facturas todavía.</p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {items.map((it) => (
            <div key={it.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <FileText size={13} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{it.file?.name}</span>
                  {it.amount != null && (
                    <span style={{ fontSize: 11, padding: "2px 8px", background: "#dcfce7", color: "#166534", borderRadius: 999, fontFamily: "JetBrains Mono, monospace", display: "inline-flex", alignItems: "center", gap: 2 }}>
                      <Euro size={10} /> {it.amount}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>
                  {showTech && it.tech_name && <span style={{ fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{it.tech_name} · </span>}
                  {showProvider && it.provider_name && <span style={{ fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{it.provider_name} · </span>}
                  {new Date(it.uploaded_at).toLocaleString("es-ES")}
                </div>
                {it.notes && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>{it.notes}</div>}
              </div>
              <a href={`${API}/file-by-id/${it.file?.file_id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, textDecoration: "none" }}>
                <ExternalLink size={12} /> Abrir
              </a>
              {canDeleteItem?.(it) && (
                <Button size="icon" variant="ghost" onClick={() => removeItem(it)}><Trash2 size={13} /></Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
