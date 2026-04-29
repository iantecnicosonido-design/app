import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import { CalendarDays, Boxes, CircleCheck, CircleAlert } from "lucide-react";

const CAT_LABEL = { audio: "Audio", video: "Video", luces: "Luces", estructuras: "Estructuras" };

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    api.get("/stats").then((r) => setStats(r.data));
    api.get("/events").then((r) => setEvents(r.data));
  }, []);

  const upcoming = [...events]
    .filter((e) => e.status === "abierto")
    .sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""))
    .slice(0, 6);

  return (
    <div data-testid="dashboard-page">
      <h2 className="page-title">Bienvenido</h2>
      <p className="page-sub">Vista general del stock y los próximos eventos</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
        <div className="stat-card" data-testid="stat-materials">
          <div className="label">Referencias</div>
          <div className="value">{stats?.total_materials ?? "—"}</div>
          <div className="delta">en inventario</div>
        </div>
        <div className="stat-card" data-testid="stat-events">
          <div className="label">Eventos</div>
          <div className="value">{stats?.total_events ?? "—"}</div>
          <div className="delta">{stats?.open_events ?? 0} abiertos · {stats?.closed_events ?? 0} cerrados</div>
        </div>
        {stats && Object.entries(stats.by_category || {}).map(([cat, v]) => (
          <div className="stat-card" key={cat} data-testid={`stat-cat-${cat}`}>
            <div className="label">{CAT_LABEL[cat] || cat}</div>
            <div className="value">{v.qty}</div>
            <div className="delta">{v.blocked} bloqueados · {v.count} refs</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div className="card-paper" data-testid="upcoming-events-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}><CalendarDays size={16} style={{ verticalAlign: "-3px", marginRight: 8, color: "var(--accent)" }} />Próximos eventos</h3>
            <Link to="/eventos" className="subtle-link">ver todos</Link>
          </div>
          {upcoming.length === 0 ? (
            <p style={{ color: "var(--ink-mute)", fontSize: 14 }}>No hay eventos abiertos.</p>
          ) : (
            <div>
              {upcoming.map((e) => (
                <Link key={e.id} to={`/eventos/${e.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="row-hover" style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{e.name}</div>
                      <div style={{ color: "var(--ink-mute)", fontSize: 12 }}>{e.client_name || "—"} · {e.location || "—"}</div>
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--ink-soft)" }}>{e.event_date || "—"}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card-paper" data-testid="quick-actions-card">
          <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Accesos rápidos</h3>
          <div style={{ display: "grid", gap: 10 }}>
            <Link to="/eventos" className="row-hover" style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 10, textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 12 }}>
              <CalendarDays size={18} color="#b45309" /> <span><b>Crear evento</b><div style={{ fontSize: 12, color: "var(--ink-mute)" }}>Bolo o alquiler simple</div></span>
            </Link>
            <Link to="/inventario" className="row-hover" style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 10, textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 12 }}>
              <Boxes size={18} color="#b45309" /> <span><b>Gestionar inventario</b><div style={{ fontSize: 12, color: "var(--ink-mute)" }}>Audio, video, luces, estructuras</div></span>
            </Link>
            <div style={{ padding: 14, border: "1px dashed var(--line)", borderRadius: 10, fontSize: 13, color: "var(--ink-soft)" }}>
              <CircleCheck size={14} style={{ verticalAlign: "-2px", color: "var(--good)", marginRight: 6 }} />
              Bloquea material desde cada evento. Al cerrarlo, exporta el listado en PDF.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
