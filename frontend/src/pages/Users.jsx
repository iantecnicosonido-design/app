import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAuth, ROLE_LABEL } from "../lib/auth";
import { Plus, Pencil, Trash2, Key, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";

const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export default function Users() {
  const { user: me } = useAuth();
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "", role: "tecnico" });
  const [pwdFor, setPwdFor] = useState(null);
  const [newPwd, setNewPwd] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return list;
    return list.filter((u) => [u.name, u.email, u.phone, ROLE_LABEL[u.role] || u.role].some((f) => norm(f).includes(q)));
  }, [list, query]);

  const load = async () => {
    setList((await api.get("/users")).data);
  };
  useEffect(() => { load(); }, []);

  const startCreate = () => { setEditing(null); setForm({ email: "", password: "", name: "", phone: "", role: "tecnico" }); setOpen(true); };
  const startEdit = (u) => { setEditing(u); setForm({ email: u.email, password: "", name: u.name, phone: u.phone || "", role: u.role }); setOpen(true); };

  const submit = async () => {
    if (!form.email.trim()) { toast.error("Email obligatorio"); return; }
    try {
      if (editing) {
        await api.put(`/users/${editing.id}`, { name: form.name, phone: form.phone, role: form.role });
      } else {
        if (form.password.length < 8) { toast.error("Contraseña mínimo 8 caracteres"); return; }
        await api.post("/users", form);
      }
      toast.success(editing ? "Actualizado" : "Creado");
      setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const toggleActive = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { active: !u.active });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const remove = async (u) => {
    if (!window.confirm(`¿Eliminar usuario ${u.email}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Eliminado");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const submitPwd = async () => {
    if (newPwd.length < 8) { toast.error("Mínimo 8 caracteres"); return; }
    try {
      await api.post(`/users/${pwdFor.id}/reset-password`, { new_password: newPwd });
      toast.success("Contraseña actualizada");
      setPwdFor(null); setNewPwd("");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  return (
    <div data-testid="users-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Usuarios</h2>
          <p className="page-sub">{filtered.length} de {list.length} usuario(s) · gestiona accesos y roles</p>
        </div>
        <Button onClick={startCreate} style={{ background: "var(--accent)" }} data-testid="new-user-btn"><Plus size={16} /> Nuevo usuario</Button>
      </div>

      <div style={{ position: "relative", marginTop: 18, marginBottom: 0 }}>
        <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-mute)" }} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar usuario por nombre, email, teléfono o rol..." style={{ paddingLeft: 36 }} data-testid="users-search" />
      </div>

      <div className="card-paper" style={{ padding: 0, marginTop: 14 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--ink-mute)", fontSize: 13 }}>
            {list.length === 0 ? "Sin usuarios." : "Ningún usuario coincide con la búsqueda."}
          </div>
        ) : filtered.map((u) => (
          <div key={u.id} className="row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 200px 120px 120px 130px", padding: "14px 22px", borderBottom: "1px solid var(--line)", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                {u.name || u.email}
                {u.id === me?.id && <span style={{ fontSize: 9, padding: "2px 6px", background: "#fef3c7", color: "#92400e", borderRadius: 999, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase" }}>TÚ</span>}
                {u.protected && <span style={{ fontSize: 9, padding: "2px 6px", background: "#fce7f3", color: "#9d174d", borderRadius: 999, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>INTERNA</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
            </div>
            <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, fontWeight: 600, background: roleBg(u.role), color: roleColor(u.role), textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>{ROLE_LABEL[u.role] || u.role}</span>
            <button onClick={() => toggleActive(u)} disabled={u.id === me?.id || u.protected} style={{ background: "none", border: "none", cursor: (u.id === me?.id || u.protected) ? "not-allowed" : "pointer", fontSize: 11, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em", color: u.active ? "var(--good)" : "var(--bad)", textAlign: "center", padding: "4px 8px", opacity: u.protected ? 0.6 : 1 }}>
              {u.active ? "● ACTIVO" : "○ INACTIVO"}
            </button>
            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
              <Button size="icon" variant="ghost" title="Cambiar contraseña" onClick={() => { setPwdFor(u); setNewPwd(""); }}><Key size={14} /></Button>
              {!u.protected && <Button size="icon" variant="ghost" onClick={() => startEdit(u)}><Pencil size={14} /></Button>}
            </div>
            <div style={{ textAlign: "right" }}>
              {u.id !== me?.id && !u.protected && <Button size="icon" variant="ghost" onClick={() => remove(u)}><Trash2 size={14} /></Button>}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar usuario" : "Nuevo usuario"}</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gap: 12 }}>
            <Lbl label="Email"><Input type="email" disabled={!!editing} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email" /></Lbl>
            <Lbl label="Nombre"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name" /></Lbl>
            <Lbl label="Teléfono (opcional)"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="user-phone" placeholder="+34 600 000 000" /></Lbl>
            <Lbl label="Rol">
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger data-testid="user-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="productor">Productor</SelectItem>
                  <SelectItem value="almacen">Almacén</SelectItem>
                  <SelectItem value="tecnico">Técnico</SelectItem>
                  <SelectItem value="taller">Taller</SelectItem>
                </SelectContent>
              </Select>
            </Lbl>
            {!editing && (
              <Lbl label="Contraseña (mín 8)"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-password" /></Lbl>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} style={{ background: "var(--accent)" }} data-testid="save-user-btn">{editing ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pwdFor} onOpenChange={(o) => !o && setPwdFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cambiar contraseña</DialogTitle></DialogHeader>
          {pwdFor && <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>Vas a cambiar la contraseña de <b>{pwdFor.email}</b>.</p>}
          <Lbl label="Nueva contraseña (mín 8)"><Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} /></Lbl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdFor(null)}>Cancelar</Button>
            <Button onClick={submitPwd} style={{ background: "var(--accent)" }}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function roleBg(role) {
  return { productor: "#fef3c7", almacen: "#e0e7ff", tecnico: "#dcfce7", taller: "#fce7f3" }[role] || "#f5f5f4";
}
function roleColor(role) {
  return { productor: "#92400e", almacen: "#3730a3", tecnico: "#166534", taller: "#9d174d" }[role] || "#78716c";
}

function Lbl({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
