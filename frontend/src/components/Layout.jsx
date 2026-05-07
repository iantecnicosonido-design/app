import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Boxes, CalendarDays, Building2, Wrench, Package, GanttChartSquare, Box } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { to: "/inventario", icon: Boxes, label: "Inventario" },
  { to: "/eventos", icon: CalendarDays, label: "Eventos" },
  { to: "/timeline", icon: GanttChartSquare, label: "Timeline" },
  { to: "/packs", icon: Package, label: "Packs" },
  { to: "/flightcases", icon: Box, label: "Flightcases" },
  { to: "/incidencias", icon: Wrench, label: "Incidencias" },
  { to: "/proveedores", icon: Building2, label: "Proveedores" },
];

export default function Layout() {
  return (
    <div className="app-shell" data-testid="app-shell">
      <aside className="sidebar">
        <h1>Stock · Eventos</h1>
        <div className="brand-sub">control de material</div>
        <nav>
          {navItems.map((it) => (
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
        <div style={{ marginTop: 32, padding: "12px 14px", borderTop: "1px solid var(--sidebar-line)", fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "#a8a29e", letterSpacing: "0.1em" }}>
          v2.0 · uso interno
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
