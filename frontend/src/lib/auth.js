import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // user: undefined = checking, null = anonymous, object = logged in
  const [user, setUser] = useState(undefined);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/auth/me");
      setUser(r.data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    if (r.data.access_token) localStorage.setItem("auth_token", r.data.access_token);
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) { /* ignore */ }
    localStorage.removeItem("auth_token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export const ROLE_LABEL = {
  productor: "Productor",
  almacen: "Almacén",
  tecnico: "Técnico",
};

export const can = (user, action) => {
  if (!user) return false;
  const role = user.role;
  switch (action) {
    case "manage_users": return role === "productor";
    case "event_edit_ficha": return role === "productor";
    case "event_close": return role === "productor" || role === "almacen";
    case "event_material": return role === "productor" || role === "almacen";
    case "inventory_edit": return role === "productor" || role === "almacen";
    case "resolve_incident": return role === "productor" || role === "almacen";
    case "create_incident": return true;
    case "export_pdf": return true;
    default: return false;
  }
};
