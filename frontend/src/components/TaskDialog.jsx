import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const empty = {
  title: "", kind: "other",
  start_dt: "", end_dt: "",
  location: "", notes: "",
  assigned_technicians: [],
  related_event_id: null,
  files: [],
};

export function TaskDialog({ open, onClose, task, defaultDate, technicians, events, onSaved }) {
  const isEdit = !!task;
  const [form, setForm] = useState(empty);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title || "",
        kind: task.kind || "other",
        start_dt: task.start_dt || "",
        end_dt: task.end_dt || "",
        location: task.location || "",
        notes: task.notes || "",
        assigned_technicians: task.assigned_technicians || [],
        related_event_id: task.related_event_id || null,
        files: task.files || [],
      });
    } else {
      const dt = defaultDate
        ? `${defaultDate}T09:00`
        : "";
      setForm({ ...empty, start_dt: dt });
    }
  }, [task, defaultDate, open]);

  const onPickFiles = async (filesList) => {
    if (!filesList || filesList.length === 0) return;
    setUploading(true);
    const added = [];
    try {
      for (const f of filesList) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        added.push({ file_id: r.data.id, name: r.data.name, content_type: r.data.content_type });
      }
      setForm((s) => ({ ...s, files: [...(s.files || []), ...added] }));
    } catch { toast.error("Error subiendo archivo"); }
    finally { setUploading(false); }
  };

  const toggleTech = (tid) => {
    setForm((s) => s.assigned_technicians.includes(tid)
      ? { ...s, assigned_technicians: s.assigned_technicians.filter((x) => x !== tid) }
      : { ...s, assigned_technicians: [...s.assigned_technicians, tid] });
  };

  const submit = async () => {
    if (!form.title.trim()) { toast.error("Título obligatorio"); return; }
    if (!form.start_dt) { toast.error("Fecha de inicio obligatoria"); return; }
    try {
      const payload = { ...form, related_event_id: form.related_event_id || null, end_dt: form.end_dt || null };
      if (isEdit) await api.put(`/tasks/${task.id}`, payload);
      else await api.post("/tasks", payload);
      toast.success(isEdit ? "Tarea actualizada" : "Tarea creada");
      onSaved && onSaved();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const remove = async () => {
    if (!isEdit) return;
    if (!window.confirm("¿Eliminar esta tarea?")) return;
    try { await api.delete(`/tasks/${task.id}`); toast.success("Eliminada"); onSaved && onSaved(); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent style={{ maxWidth: 640, maxHeight: "92vh", overflowY: "auto" }} data-testid="task-dialog">
        <DialogHeader><DialogTitle>{isEdit ? "Editar tarea" : "Nueva tarea de técnico"}</DialogTitle></DialogHeader>
        <div style={{ display: "grid", gap: 12 }}>
          <Lbl label="Título">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej. Transporte material a Barcelona" data-testid="task-title" />
          </Lbl>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Lbl label="Tipo">
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger data-testid="task-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transport">Transporte</SelectItem>
                  <SelectItem value="warehouse">Trabajo en nave</SelectItem>
                  <SelectItem value="visit">Visita técnica</SelectItem>
                  <SelectItem value="other">Otro</SelectItem>
                </SelectContent>
              </Select>
            </Lbl>
            <Lbl label="Evento asociado (opcional)">
              <Select value={form.related_event_id || "__none__"} onValueChange={(v) => setForm({ ...form, related_event_id: v === "__none__" ? null : v })}>
                <SelectTrigger data-testid="task-event"><SelectValue placeholder="Sin evento" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Sin evento asociado —</SelectItem>
                  {(events || []).filter((e) => e.status !== "cerrado").slice(0, 200).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}{e.reference ? ` · ${e.reference}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Lbl>
            <Lbl label="Inicio">
              <Input type="datetime-local" value={form.start_dt} onChange={(e) => setForm({ ...form, start_dt: e.target.value })} data-testid="task-start" />
            </Lbl>
            <Lbl label="Fin (opcional)">
              <Input type="datetime-local" value={form.end_dt || ""} onChange={(e) => setForm({ ...form, end_dt: e.target.value })} data-testid="task-end" />
            </Lbl>
          </div>
          <Lbl label="Ubicación">
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Dirección, almacén, cliente..." data-testid="task-location" />
          </Lbl>
          <Lbl label="Notas">
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="task-notes" />
          </Lbl>
          <Lbl label="Técnicos asignados">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 8, border: "1px solid var(--line)", borderRadius: 6, maxHeight: 160, overflowY: "auto" }}>
              {(technicians || []).map((t) => {
                const checked = form.assigned_technicians.includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => toggleTech(t.id)} data-testid={`task-tech-${t.email}`}
                    style={{
                      padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500,
                      background: checked ? "var(--accent)" : "#fff",
                      color: checked ? "#fff" : "var(--ink)",
                      border: `1px solid ${checked ? "var(--accent)" : "var(--line)"}`,
                      cursor: "pointer",
                    }}
                  >
                    {t.name || t.email}
                  </button>
                );
              })}
              {(technicians || []).length === 0 && <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>Sin técnicos disponibles</span>}
            </div>
          </Lbl>
          <Lbl label="Adjuntos (opcional)">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "1px dashed var(--line)", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                <Plus size={14} /> Subir archivo
                <input type="file" multiple style={{ display: "none" }} onChange={(e) => onPickFiles(e.target.files)} data-testid="task-file-input" />
              </label>
              {uploading && <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>Subiendo…</span>}
            </div>
            {(form.files || []).length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {form.files.map((f, i) => (
                  <span key={f.file_id} style={{ fontSize: 11, padding: "4px 8px", background: "#dcfce7", color: "#166534", borderRadius: 4, fontFamily: "JetBrains Mono, monospace", display: "inline-flex", gap: 6 }}>
                    {f.name}
                    <button onClick={() => setForm({ ...form, files: form.files.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", cursor: "pointer", color: "#166534" }}>×</button>
                  </span>
                ))}
              </div>
            )}
          </Lbl>
        </div>
        <DialogFooter style={{ justifyContent: "space-between" }}>
          {isEdit ? (
            <Button variant="ghost" onClick={remove} title="Eliminar tarea"><Trash2 size={14} color="#b91c1c" /></Button>
          ) : <div />}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-task-btn">{isEdit ? "Guardar" : "Crear tarea"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Lbl({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
