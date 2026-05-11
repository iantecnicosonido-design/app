import { useRef, useState } from "react";
import { api, API } from "../lib/api";
import { Button } from "./ui/button";
import { FileText, Upload, Trash2, ExternalLink, Euro, ReceiptText } from "lucide-react";
import { toast } from "sonner";

export default function EventFinanceDocs({ event, onChanged }) {
  // visible only to productor (backend already scrubs budget/invoice for others)
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }} data-testid="event-finance-docs">
      <FinanceDoc
        label="Presupuesto"
        icon={<Euro size={16} />}
        doc={event.event_budget}
        eventId={event.id}
        endpoint="budget"
        onChanged={onChanged}
        accent="#0f766e"
      />
      <FinanceDoc
        label="Factura"
        icon={<ReceiptText size={16} />}
        doc={event.event_invoice}
        eventId={event.id}
        endpoint="invoice"
        onChanged={onChanged}
        accent="#7c2d12"
      />
    </div>
  );
}

function FinanceDoc({ label, icon, doc, eventId, endpoint, onChanged, accent }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef();

  const upload = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      toast.error("Solo se admiten archivos PDF");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const up = await api.post("/upload", fd);
      const fp = { file_id: up.data.id, name: up.data.name, content_type: up.data.content_type, storage_path: up.data.path, size: up.data.size };
      await api.post(`/events/${eventId}/${endpoint}`, { file: fp });
      toast.success(`${label} subido`);
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };

  const remove = async () => {
    if (!window.confirm(`¿Eliminar ${label.toLowerCase()}?`)) return;
    try { await api.delete(`/events/${eventId}/${endpoint}`); onChanged?.(); toast.success("Eliminado"); }
    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div className="card-paper" style={{ borderLeft: `3px solid ${accent}`, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: accent }}>
          {icon} {label}
          <span style={{ fontSize: 10, padding: "2px 8px", background: "#fce7f3", color: "#9d174d", borderRadius: 999, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>SOLO PRODUCTOR</span>
        </div>
        <input type="file" ref={ref} hidden accept="application/pdf" onChange={(e) => upload(e.target.files?.[0])} data-testid={`${endpoint}-input`} />
        {!doc ? (
          <Button size="sm" onClick={() => ref.current?.click()} disabled={busy} style={{ background: accent }} data-testid={`upload-${endpoint}-btn`}>
            <Upload size={13} /> {busy ? "Subiendo..." : "Subir PDF"}
          </Button>
        ) : (
          <div style={{ display: "flex", gap: 4 }}>
            <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={busy} title="Reemplazar"><Upload size={13} /></Button>
            <Button size="icon" variant="ghost" onClick={remove}><Trash2 size={13} /></Button>
          </div>
        )}
      </div>
      {doc ? (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <a href={`${API}/file-by-id/${doc.file_id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink)", fontSize: 13, textDecoration: "none" }}>
            <FileText size={14} /> {doc.name}
            <ExternalLink size={11} />
          </a>
          <span style={{ fontSize: 10, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString("es-ES") : ""}
          </span>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-mute)" }}>Aún no se ha subido</div>
      )}
    </div>
  );
}
