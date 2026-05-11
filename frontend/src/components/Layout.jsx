import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Boxes, CalendarDays, Building2, Wrench, Package, GanttChartSquare, Box, Truck, Users as UsersIcon, LogOut, Hammer } from "lucide-react";
import { useAuth, ROLE_LABEL } from "../lib/auth";
import NotificationBell from "./NotificationBell";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", exact: true, roles: ["productor", "almacen", "tecnico"] },
  { to: "/inventario", icon: Boxes, label: "Inventario", roles: ["productor", "almacen"] },
  { to: "/eventos", icon: CalendarDays, label: "Eventos", roles: ["productor", "almacen", "tecnico"] },
  { to: "/timeline", icon: GanttChartSquare, label: "Timeline", roles: ["productor", "almacen"] },
  { to: "/packs", icon: Package, label: "Packs", roles: ["productor", "almacen"] },
  { to: "/flightcases", icon: Box, label: "Flightcases", roles: ["productor", "almacen"] },
  { to: "/vehiculos", icon: Truck, label: "Vehículos", roles: ["productor", "almacen"] },
  { to: "/incidencias", icon: Wrench, label: "Incidencias", roles: ["productor", "almacen", "tecnico", "taller"] },
  { to: "/proveedores", icon: Building2, label: "Proveedores", roles: ["productor", "almacen"] },
  { to: "/usuarios", icon: UsersIcon, label: "Usuarios", roles: ["productor"] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const role = user?.role;
  const items = navItems.filter((it) => !it.roles || it.roles.includes(role));

  const doLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: "#fafaf9", margin: "-28px -18px 20px -18px", borderBottom: "1px solid var(--sidebar-line)" }}>
          <img src="/logo.png" alt="Edison Rent" style={{ height: 32, width: "auto", flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em", whiteSpace: "nowrap", fontFamily: "'Outfit', sans-serif" }}>Edison Rent</h1>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: "#78716c", letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 2 }}>control material</div>
          </div>
        </div>
        <nav>
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.exact}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              data-testid={`nav-${it.label.toLowerCase()}`}
            >
              <it.icon size={18} strokeWidth={1.8} />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: "auto" }}>
          {user && (
            <div style={{ padding: "14px", borderTop: "1px solid var(--sidebar-line)", fontSize: 12 }}>
              <div style={{ color: "#fafaf9", fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="current-user-name">{user.name || user.email}</div>
              <div style={{ color: "#a8a29e", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", fontSize: 10, letterSpacing: "0.1em", marginBottom: 10 }} data-testid="current-user-role">{ROLE_LABEL[role] || role}</div>
              <NotificationBell />
              <button onClick={doLogout} data-testid="logout-btn" style={{ marginTop: 8, background: "transparent", border: "1px solid var(--sidebar-line)", color: "#fafaf9", padding: "6px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", width: "100%", justifyContent: "flex-start" }}>
                <LogOut size={12} /> Cerrar sesión
              </button>
            </div>
          )}
          <div style={{ padding: "10px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "#a8a29e", letterSpacing: "0.1em" }}>
            v2.1 · uso interno
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
