import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  useEffect(() => { document.title = "Login · Edison Rent"; }, []);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success("Bienvenido");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "No se pudo iniciar sesión");
    } finally { setBusy(false); }
  };

  const submitForgot = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const { api } = await import("../lib/api");
      await api.post("/auth/forgot-password", { email: forgotEmail.trim() });
      toast.success("Si el email existe, te enviaremos instrucciones.");
      setForgot(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Error");
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} data-testid="login-page">
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src="/logo.png" alt="Edison Rent" style={{ height: 96, marginBottom: 16, display: "inline-block" }} />
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Edison Rent</h1>
          <p style={{ fontSize: 12, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.1em", margin: "6px 0 0 0" }}>Control de material</p>
        </div>
        <form onSubmit={forgot ? submitForgot : submit} className="card-paper" style={{ padding: 28 }}>
          <h2 style={{ margin: "0 0 18px 0", fontSize: 18, fontWeight: 600 }}>{forgot ? "Recuperar contraseña" : "Iniciar sesión"}</h2>
          {!forgot ? (
            <>
              <Lbl label="Email"><Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required data-testid="login-email" /></Lbl>
              <Lbl label="Contraseña"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="login-password" /></Lbl>
              <Button type="submit" disabled={busy} style={{ background: "var(--accent)", width: "100%", marginTop: 12 }} data-testid="login-submit">
                {busy ? "Entrando..." : "Entrar"}
              </Button>
              <p style={{ fontSize: 12, marginTop: 14, textAlign: "center" }}>
                <button type="button" onClick={() => { setForgot(true); setForgotEmail(email); }} className="subtle-link" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  ¿Olvidaste tu contraseña?
                </button>
              </p>
            </>
          ) : (
            <>
              <Lbl label="Email"><Input type="email" autoFocus value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required /></Lbl>
              <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 8 }}>
                Te enviaremos un enlace para restablecer la contraseña.
              </p>
              <Button type="submit" disabled={busy} style={{ background: "var(--accent)", width: "100%", marginTop: 12 }}>
                {busy ? "Enviando..." : "Enviar enlace"}
              </Button>
              <p style={{ fontSize: 12, marginTop: 12, textAlign: "center" }}>
                <button type="button" onClick={() => setForgot(false)} className="subtle-link" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Volver al login
                </button>
              </p>
            </>
          )}
        </form>
      </div>
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
