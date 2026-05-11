import { useRef, useState } from "react";
import { api, API } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Phone, User as UserIcon, Mail, Plus, Pencil, Trash2, FileText, Upload, ExternalLink, FolderOpen } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_LABELS = {
  hoja_ruta: "Hoja de ruta",
  rider: "Riders",
  contrarider: "Contrariders",
  implantacion: "Implantación",
  otros: "Otros",
};
const CATEGORY_ORDER = ["hoja_ruta", "rider", "contrarider", "implantacion", "otros"];

export function ContactsSection({ event, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", role: "", phone: "", email: "" });
  const eid = event.id;

  const startCreate = () => { setEditing(null); setForm({ name: "", role: "", phone: "", email: "" }); setOpen(true); };
  const startEdit = (c) => { setEditing(c); setForm({ name: c.name || "", role: c.role || "", phone: c.phone || "", email: c.email || "" }); setOpen(true); };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Nombre obligatorio"); return; }
    try {
      if (editing) await api.put(`/events/${eid}/contacts/${editing.id}`, form);
      else await api.post(`/events/${eid}/contacts`, form);
      setOpen(false); onChanged?.();
      toast.success(editing ? "Actualizado" : "Añadido");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const remove = async (c) => {
    if (!window.confirm(`¿Eliminar el contacto ${c.name}?`)) return;
    try { await api.delete(`/events/${eid}/contacts/${c.id}`); onChanged?.(); toast.success("Eliminado"); }
    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const contacts = event.contacts || [];

  return (
    <div className="card-paper" data-testid="contacts-section" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <Phone size={16} /> Contactos del evento
          <span style={{ fontSize: 11, padding: "2px 8px", background: "#f5f5f4", color: "var(--ink-mute)", borderRadius: 999, fontFamily: "JetBrains Mono, monospace" }}>{contacts.length}</span>
        </h3>
        {canEdit && (
          <Button size="sm" onClick={startCreate} style={{ background: "var(--accent)" }} data-testid="add-contact-btn"><Plus size={14} /> Añadir contacto</Button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p style={{ color: "var(--ink-mute)", fontSize: 13 }}>Sin contactos añadidos.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
          {contacts.map((c) => (
            <div key={c.id} style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 6, background: "#fafaf9", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  <UserIcon size={13} /> {c.name}
                </div>
                {c.role && <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{c.role}</div>}
                {c.phone && (
                  <a href={`tel:${c.phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--ink)", marginTop: 6, textDecoration: "none" }}>
                    <Phone size={11} /> {c.phone}
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--ink-mute)", marginTop: 4, textDecoration: "none" }}>
                    <Mail size={11} /> {c.email}
                  </a>
                )}
              </div>
              {canEdit && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(c)}><Pencil size={12} /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(c)}><Trash2 size={12} /></Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar contacto" : "Nuevo contacto"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 10 }}>
            <Input placeholder="Nombre *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="contact-name" autoFocus />
            <Input placeholder="Rol / cargo (ej: Regidor, Manager, Cliente)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="contact-role" />
            <Input placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="contact-phone" />
            <Input placeholder="Email (opcional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="contact-email" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--good)" }} data-testid="contact-save">Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DocumentsSection({ event, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("hoja_ruta");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const eid = event.id;
  const docs = event.documents || [];

  // Group by category
  const grouped = {};
  CATEGORY_ORDER.forEach((c) => { grouped[c] = []; });
  docs.forEach((d) => { (grouped[d.category] || (grouped.otros = grouped.otros || [])).push(d); });

  const submit = async () => {
    if (!file) { toast.error("Selecciona un archivo"); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const up = await api.post("/upload", fd);
      const fp = { file_id: up.data.id, name: up.data.name, content_type: up.data.content_type, storage_path: up.data.path, size: up.data.size };
      await api.post(`/events/${eid}/documents`, { category, file: fp, notes });
      toast.success("Documento subido");
      setOpen(false); setNotes(""); setFile(null); if (fileRef.current) fileRef.current.value = "";
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
    finally { setBusy(false); }
  };

  const remove = async (d) => {
    if (!window.confirm("¿Eliminar este documento?")) return;
    try { await api.delete(`/events/${eid}/documents/${d.id}`); onChanged?.(); toast.success("Eliminado"); }
    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div className="card-paper" data-testid="documents-section" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <FolderOpen size={16} /> Documentación
          <span style={{ fontSize: 11, padding: "2px 8px", background: "#f5f5f4", color: "var(--ink-mute)", borderRadius: 999, fontFamily: "JetBrains Mono, monospace" }}>{docs.length}</span>
        </h3>
        {canEdit && (
          <Button size="sm" onClick={() => setOpen(true)} style={{ background: "var(--accent)" }} data-testid="add-document-btn"><Plus size={14} /> Añadir documento</Button>
        )}
      </div>

      {docs.length === 0 ? (
        <p style={{ color: "var(--ink-mute)", fontSize: 13 }}>Sin documentos. Sube hojas de ruta, riders, implantación...</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped[cat] || [];
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>
                  {CATEGORY_LABELS[cat]} · {items.length}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {items.map((d) => (
                    <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 6, background: "#fafaf9" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                          <FileText size={13} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.file?.name}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>
                          <span style={{ fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{d.uploaded_by_name}</span>
                          {" · "}
                          {new Date(d.uploaded_at).toLocaleString("es-ES")}
                        </div>
                        {d.notes && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>{d.notes}</div>}
                      </div>
                      <a href={`${API}/file-by-id/${d.file?.file_id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, textDecoration: "none" }}>
                        <ExternalLink size={12} /> Abrir
                      </a>
                      {canEdit && <Button size="icon" variant="ghost" onClick={() => remove(d)}><Trash2 size={13} /></Button>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Subir documento</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 10 }}>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="doc-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
              </SelectContent>
            </Select>
            <input type="file" ref={fileRef} onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="doc-file" />
            <Textarea placeholder="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={busy || !file} style={{ background: "var(--good)" }} data-testid="doc-submit"><Upload size={14} /> {busy ? "Subiendo..." : "Subir"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
