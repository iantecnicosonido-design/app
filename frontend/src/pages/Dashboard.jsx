import { useEffect, useMemo, useState } from "react";
import { api, formatDate } from "../lib/api";
import { Link } from "react-router-dom";
import { CalendarDays, Boxes, Wrench, Package, GanttChartSquare, CheckCircle2, Clock } from "lucide-react";
import { MonthCalendar } from "./Events";
import { useAuth } from "../lib/auth";

function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  useEffect(() => {
    api.get("/stats").then((r) => setStats(r.data));
    api.get("/events").then((r) => setEvents(r.data));
  }, []);

  const groups = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const wkStart = startOfWeek(now);
    const wkEnd = addDays(wkStart, 7);
    const nextWkEnd = addDays(wkEnd, 7);

    const inRange = (e, from, to) => {
      const d = e.event_date ? new Date(e.event_date) : null;
      if (!d) return false;
      d.setHours(0, 0, 0, 0);
      return d >= from && d < to;
    };

    const future = (e) => {
      const d = e.event_date ? new Date(e.event_date) : null;
      if (!d) return false;
      d.setHours(0, 0, 0, 0);
      return d >= nextWkEnd;
    };

    const sortByDate = (a, b) => (a.event_date || "").localeCompare(b.event_date || "");

    return {
      thisWeek: events.filter((e) => inRange(e, wkStart, wkEnd)).sort(sortByDate),
      nextWeek: events.filter((e) => inRange(e, wkEnd, nextWkEnd)).sort(sortByDate),
      later: events.filter(future).sort(sortByDate),
    };
  }, [events]);

  // ------ Almacén-specific dashboard ------
  if (user?.role === "almacen") {
    return <AlmacenDashboard stats={stats} events={events} calYear={calYear} calMonth={calMonth} setCalYear={setCalYear} setCalMonth={setCalMonth} today={today} />;
  }

  return (
    <div data-testid="dashboard-page">
      <h2 className="page-title">Bienvenido</h2>
      <p className="page-sub">Resumen de la actividad</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
        <StatCard label="Eventos abiertos" value={stats?.open_events ?? "—"} sub={`${stats?.closed_events ?? 0} cerrados`} icon={CalendarDays} />
        <StatCard label="Material" value={stats?.total_units ?? "—"} sub={`${stats?.total_materials ?? 0} referencias`} icon={Boxes} />
        <StatCard label="Incidencias abiertas" value={stats?.incidents ?? 0} sub="averías o reparación" icon={Wrench} alert={(stats?.incidents ?? 0) > 0} />
        <StatCard label="Esta semana" value={groups.thisWeek.length} sub={`${groups.thisWeek.filter(e => e.status==="cerrado").length} cerrados`} icon={CalendarDays} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18, marginBottom: 18 }}>
        <MonthCalendar year={calYear} month={calMonth} events={events} compact
          onPrev={() => { if (calMonth === 0) { setCalYear(calYear - 1); setCalMonth(11); } else setCalMonth(calMonth - 1); }}
          onNext={() => { if (calMonth === 11) { setCalYear(calYear + 1); setCalMonth(0); } else setCalMonth(calMonth + 1); }}
          onToday={() => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); }}
        />
        <div className="card-paper">
          <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Accesos rápidos</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <QA to="/eventos" icon={CalendarDays} label="Crear evento" sub="Bolo o alquiler" />
            <QA to="/inventario" icon={Boxes} label="Inventario" sub="Audio · Video · Luces · Estructuras" />
            <QA to="/timeline" icon={GanttChartSquare} label="Timeline" sub="Ver ocupación mensual" />
            <QA to="/packs" icon={Package} label="Packs" sub="Plantillas de material" />
            <QA to="/incidencias" icon={Wrench} label="Incidencias" sub="Averías y reparaciones" />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
        <EventsCard title="Esta semana" events={groups.thisWeek} empty="Sin eventos esta semana." />
        <EventsCard title="Próxima semana" events={groups.nextWeek} empty="Sin eventos la próxima semana." />
        <EventsCard title="Más adelante" events={groups.later} empty="Nada planificado todavía." />
      </div>
    </div>
  );
}

// ===== Almacén-specific dashboard =====
function AlmacenDashboard({ stats, events, calYear, calMonth, setCalYear, setCalMonth, today }) {
  const openEvents = events.filter((e) => e.status === "abierto");
  const prepReady = openEvents
    .filter((e) => e.prep_status === "preparado")
    .sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));
  const prepPending = openEvents
    .filter((e) => e.prep_status !== "preparado")
    .sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));

  return (
    <div data-testid="dashboard-page">
      <h2 className="page-title">Almacén</h2>
      <p className="page-sub">Estado de preparación y avisos</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 22 }}>
        <StatCard
          label="Eventos preparados"
          value={stats?.prep_ready ?? prepReady.length}
          sub="bloqueados por almacén"
          icon={CheckCircle2}
          tone="good"
        />
        <StatCard
          label="Pendientes de preparar"
          value={stats?.prep_pending ?? prepPending.length}
          sub="con material asignado o por revisar"
          icon={Clock}
          tone="warn"
        />
        <StatCard
          label="Incidencias abiertas"
          value={stats?.incidents ?? 0}
          sub="averías o reparación"
          icon={Wrench}
          alert={(stats?.incidents ?? 0) > 0}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18, marginBottom: 18 }}>
        <MonthCalendar
          year={calYear}
          month={calMonth}
          events={events}
          compact
          onPrev={() => { if (calMonth === 0) { setCalYear(calYear - 1); setCalMonth(11); } else setCalMonth(calMonth - 1); }}
          onNext={() => { if (calMonth === 11) { setCalYear(calYear + 1); setCalMonth(0); } else setCalMonth(calMonth + 1); }}
          onToday={() => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); }}
        />
        <div className="card-paper">
          <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700 }}>Accesos rápidos</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <QA to="/eventos" icon={CalendarDays} label="Eventos" sub="Ver todos los eventos" />
            <QA to="/inventario" icon={Boxes} label="Inventario" sub="Material y unidades" />
            <QA to="/flightcases" icon={Package} label="Flightcases" sub="Cableado y reparto" />
            <QA to="/vehiculos" icon={Boxes} label="Vehículos" sub="Furgonetas y alquileres" />
            <QA to="/incidencias" icon={Wrench} label="Incidencias" sub="Averías y reparaciones" />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 18 }}>
        <PrepEventsCard
          title="Pendientes de preparar"
          icon={Clock}
          color="#b45309"
          events={prepPending}
          empty="Todo al día. No hay eventos pendientes de preparar."
          testid="prep-pending-list"
        />
        <PrepEventsCard
          title="Preparados"
          icon={CheckCircle2}
          color="#166534"
          events={prepReady}
          empty="Sin eventos preparados ahora mismo."
          testid="prep-ready-list"
        />
      </div>
    </div>
  );
}

function PrepEventsCard({ title, icon: Icon, color, events, empty, testid }) {
  return (
    <div className="card-paper" data-testid={testid}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8, color }}>
          <Icon size={16} /> {title}
        </h3>
        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)" }}>{events.length}</span>
      </div>
      {events.length === 0 ? (
        <p style={{ color: "var(--ink-mute)", fontSize: 13, margin: 0 }}>{empty}</p>
      ) : (
        <div style={{ display: "grid", gap: 4, maxHeight: 360, overflowY: "auto" }}>
          {events.map((e) => {
            const totalUnits =
              (e.materials || []).reduce((acc, m) => acc + (m.units || []).length, 0) +
              (e.rentals || []).length;
            const checkedCount = (e.prep_checks || []).length;
            return (
              <Link
                key={e.id}
                to={`/eventos/${e.id}/preparacion`}
                className="row-hover"
                style={{
                  display: "grid", gridTemplateColumns: "1fr 90px 90px",
                  alignItems: "center", gap: 8,
                  padding: "8px 10px", borderRadius: 6,
                  textDecoration: "none", color: "inherit",
                  background: "#faf6ef",
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {e.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {e.type} {e.client_name ? `· ${e.client_name}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)", textAlign: "right" }}>
                  {formatDate(e.event_date)}
                </span>
                <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: checkedCount === totalUnits && totalUnits > 0 ? "var(--good)" : "var(--ink-mute)", textAlign: "right" }}>
                  {checkedCount}/{totalUnits}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, alert, tone }) {
  const toneStyles = {
    good: { border: "#86efac", bg: "#f0fdf4", color: "#166534" },
    warn: { border: "#fcd34d", bg: "#fffbeb", color: "#b45309" },
  };
  const t = tone ? toneStyles[tone] : null;
  return (
    <div className="stat-card" style={{
      borderColor: alert ? "#b91c1c" : (t?.border || "var(--line)"),
      background: alert ? "#fef2f2" : (t?.bg || "#fff"),
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="label">{label}</div>
        {Icon && <Icon size={16} color={alert ? "#b91c1c" : (t?.color || "var(--ink-mute)")} />}
      </div>
      <div className="value" style={{ color: alert ? "#b91c1c" : (t?.color || "var(--ink)") }}>{value}</div>
      <div className="delta">{sub}</div>
    </div>
  );
}

function QA({ to, icon: Icon, label, sub }) {
  return (
    <Link to={to} className="row-hover" style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 10, textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 12 }}>
      <Icon size={18} color="var(--accent)" />
      <div><div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div><div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{sub}</div></div>
    </Link>
  );
}

function EventsCard({ title, events, empty }) {
  const opens = events.filter((e) => e.status !== "cerrado");
  const closeds = events.filter((e) => e.status === "cerrado");
  return (
    <div className="card-paper">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)" }}>{events.length}</span>
      </div>
      {events.length === 0 ? <p style={{ color: "var(--ink-mute)", fontSize: 13, margin: 0 }}>{empty}</p> : (
        <>
          <Section title="Abiertos" items={opens} color="var(--good)" />
          <Section title="Cerrados" items={closeds} color="var(--ink-mute)" />
        </>
      )}
    </div>
  );
}

function Section({ title, items, color }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.12em", color, fontWeight: 700, marginBottom: 6 }}>{title} · {items.length}</div>
      {items.map((e) => (
        <Link key={e.id} to={`/eventos/${e.id}`} className="row-hover" style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", borderRadius: 6, textDecoration: "none", color: "inherit", marginBottom: 2, background: "#faf6ef" }}>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>
            {e.name} <span style={{ fontSize: 10, marginLeft: 4, color: e.type === "bolo" ? "#92400e" : "#1e3a8a", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase" }}>{e.type}</span>
          </span>
          <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)" }}>{formatDate(e.event_date)}</span>
        </Link>
      ))}
    </div>
  );
}
