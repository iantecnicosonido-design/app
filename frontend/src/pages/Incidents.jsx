import { useEffect, useState } from "react";
import { api, API } from "../lib/api";
import { Plus, Wrench, FileText, Image as ImgIcon, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";

export default function Incidents() {
  const [list, setList] = useState([]);
  const [units, setUnits] = useState([]);
  const [openNew, setOpenNew] = useState(false);
  const [openHistory, setOpenHistory] = useState(null);
  const [history, setHistory] = useState([]);
  const [openResolve, setOpenResolve] = useState(null);
  const [form, setForm] = useState({ unit_id: "", status: "broken", description: "", files: [] });
  const [resolveForm, setResolveForm] = useState({ description: "", files: [] });

  const load = async () => {
    setList((await api.get("/incidents")).data);
    setUnits((await api.get("/units")).data);
  };
  useEffect(() => { load(); }, []);

  const upload = async (files, target) => {
    const uploaded = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const r = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
        uploaded.push(r.data);
      } catch (e) { toast.error(`Error subiendo ${f.name}`); }
    }
    if (target === "new") setForm((s) => ({ ...s, files: [...s.files, ...uploaded] }));
    else setResolveForm((s) => ({ ...s, files: [...s.files, ...uploaded] }));
  };

  const submitNew = async () => {
    if (!form.unit_id) { toast.error("Elige una unidad"); return; }
    if (!form.description.trim()) { toast.error("Describe la avería"); return; }
    try {
      await api.post("/incidents", form);
      toast.success("Incidencia registrada");
      setOpenNew(false); setForm({ unit_id: "", status: "broken", description: "", files: [] });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const showHistory = async (item) => {
    const r = await api.get(`/units/${item.unit.id}/history`);
    setHistory(r.data); setOpenHistory(item);
  };

  const submitResolve = async () => {
    try {
      await api.post(`/incidents/${openResolve.unit.id}/resolve`, resolveForm);
      toast.success("Resuelto, unidad disponible"); setOpenResolve(null);
      setResolveForm({ description: "", files: [] });
      load();
    } catch (e) { toast.error("Error"); }
  };

  const availableUnits = units.filter((u) => u.status === "available");

  return (
    <div data-testid="incidents-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div><h2 className="page-title">Incidencias</h2><p className="page-sub">{list.length} unidades en avería o reparación</p></div>
        <Button onClick={() => setOpenNew(true)} style={{ background: "var(--accent)" }} data-testid="new-incident-btn"><Plus size={16} /> Reportar avería</Button>
      </div>

      {list.length === 0 ? (
        <div className="card-paper" style={{ textAlign: "center", padding: 60, color: "var(--ink-mute)" }}>
          <Wrench size={32} style={{ marginBottom: 10, opacity: 0.4 }} /><br />
          Sin incidencias. Todo el inventario está disponible.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {list.map((it) => (
            <div key={it.unit.id} className="card-paper" style={{ display: "grid", gridTemplateColumns: "120px 1fr 130px 120px 110px", gap: 14, alignItems: "center" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>{it.unit.reference}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{it.material?.name || "—"}</div>
                {it.latest && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 4 }}>{it.latest.description}</div>}
              </div>
              <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: it.unit.status === "broken" ? "#fee2e2" : "#fef3c7", color: it.unit.status === "broken" ? "#991b1b" : "#92400e", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>{it.unit.status === "broken" ? "AVERIADO" : "REPARACIÓN"}</span>
              <Button size="sm" variant="outline" onClick={() => showHistory(it)}>Histórico</Button>
              <Button size="sm" onClick={() => setOpenResolve(it)} style={{ background: "var(--good)" }}>Resolver</Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent style={{ maxWidth: 600 }}>
          <DialogHeader><DialogTitle>Reportar incidencia</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Unidad afectada">
              <Select value={form.unit_id} onValueChange={(v) => setForm({ ...form, unit_id: v })}>
                <SelectTrigger><SelectValue placeholder="Elige unidad..." /></SelectTrigger>
                <SelectContent>{availableUnits.map((u) => <SelectItem key={u.id} value={u.id}>{u.reference}</SelectItem>)}</SelectContent>
              </Select>
            </Lbl>
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
          {openResolve && <p style={{ color: "var(--ink-mute)", fontSize: 13 }}>Marca <b>{openResolve.unit.reference}</b> como disponible.</p>}
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
          <DialogHeader><DialogTitle>Histórico · {openHistory?.unit?.reference}</DialogTitle></DialogHeader>
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
