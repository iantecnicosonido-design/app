import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "Restablecer contraseña"; }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (!token) { toast.error("Falta token"); return; }
    if (pwd.length < 8) { toast.error("Mínimo 8 caracteres"); return; }
    if (pwd !== pwd2) { toast.error("Las contraseñas no coinciden"); return; }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pwd });
      toast.success("Contraseña restablecida. Inicia sesión.");
      nav("/login");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Error");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} data-testid="reset-page">
      <form onSubmit={submit} className="card-paper" style={{ padding: 28, width: "100%", maxWidth: 420 }}>
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 600 }}>Nueva contraseña</h2>
        <Lbl label="Contraseña"><Input type="password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} required /></Lbl>
        <Lbl label="Repetir contraseña"><Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} required /></Lbl>
        <Button type="submit" disabled={busy} style={{ background: "var(--accent)", width: "100%", marginTop: 12 }}>
          {busy ? "Guardando..." : "Guardar"}
        </Button>
      </form>
    </div>
  );
}

function Lbl({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
