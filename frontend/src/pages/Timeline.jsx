import { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button";

const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function Timeline() {
  const [events, setEvents] = useState([]);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  useEffect(() => { api.get("/events").then((r) => setEvents(r.data)); }, []);

  const monthStart = useMemo(() => new Date(year, month, 1), [year, month]);
  const monthEnd = useMemo(() => new Date(year, month + 1, 0), [year, month]);
  const daysInMonth = monthEnd.getDate();

  const eventsInMonth = useMemo(() => {
    const startWindow = (e) => {
      const d = e.warehouse_out_dt || e.setup_date || e.event_date;
      return d ? new Date(d) : null;
    };
    const endWindow = (e) => {
      const d = e.dismount_end_dt || e.return_dt || e.end_date || e.event_date;
      return d ? new Date(d) : null;
    };
    const filtered = events.map((e) => ({ ev: e, start: startWindow(e), end: endWindow(e) }))
      .filter((x) => x.start && x.end && x.start <= monthEnd && x.end >= monthStart)
      .sort((a, b) => a.start - b.start);
    // assign rows for non-overlap
    const rows = [];
    filtered.forEach((it) => {
      let row = rows.findIndex((r) => r.every((other) => it.start >= other.end || it.end <= other.start));
      if (row === -1) { rows.push([it]); row = rows.length - 1; }
      else rows[row].push(it);
      it.row = row;
    });
    return filtered;
  }, [events, monthStart, monthEnd]);

  const dayWidth = 36;
  const totalWidth = daysInMonth * dayWidth;

  const prev = () => { if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1); };

  const colorFor = (ev) => ev.type === "bolo" ? "#fef3c7" : "#dbeafe";
  const borderFor = (ev) => ev.type === "bolo" ? "#92400e" : "#1e3a8a";

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const totalRows = eventsInMonth.reduce((max, x) => Math.max(max, x.row + 1), 1);

  return (
    <div data-testid="timeline-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div><h2 className="page-title">Timeline</h2><p className="page-sub">Vista mensual de ocupación de eventos</p></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="outline" size="icon" onClick={prev}><ChevronLeft size={16} /></Button>
          <span style={{ fontWeight: 600, fontSize: 16, minWidth: 180, textAlign: "center", fontFamily: "JetBrains Mono, monospace" }}>{MONTHS_ES[month]} {year}</span>
          <Button variant="outline" size="icon" onClick={next}><ChevronRight size={16} /></Button>
        </div>
      </div>

      <div className="card-paper" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ minWidth: totalWidth + 40, position: "relative" }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--line)", background: "#faf6ef" }}>
            {days.map((d) => {
              const dt = new Date(year, month, d);
              const dow = dt.getDay();
              const isWeekend = dow === 0 || dow === 6;
              return (
                <div key={d} style={{ width: dayWidth, padding: "10px 0", textAlign: "center", borderRight: "1px solid var(--line)", background: isWeekend ? "#f5efe2" : "transparent", fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: isWeekend ? "var(--ink-mute)" : "var(--ink-soft)" }}>
                  <div>{d}</div>
                  <div style={{ fontSize: 9, opacity: 0.6 }}>{["D", "L", "M", "X", "J", "V", "S"][dow]}</div>
                </div>
              );
            })}
          </div>

          <div style={{ position: "relative", height: totalRows * 36 + 16, padding: "8px 0" }}>
            {eventsInMonth.map(({ ev, start, end, row }) => {
              const sd = Math.max(0, Math.floor((start - monthStart) / (1000 * 60 * 60 * 24)));
              const ed = Math.min(daysInMonth - 1, Math.floor((end - monthStart) / (1000 * 60 * 60 * 24)));
              const left = sd * dayWidth + 2;
              const width = (ed - sd + 1) * dayWidth - 4;
              const top = 8 + row * 34;
              return (
                <Link key={ev.id} to={`/eventos/${ev.id}`} style={{
                  position: "absolute", left, width, top, height: 28,
                  background: colorFor(ev), border: `1.5px solid ${borderFor(ev)}`,
                  borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600,
                  color: borderFor(ev), textDecoration: "none", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                  display: "flex", alignItems: "center"
                }} title={`${ev.name} (${ev.type})`}>
                  {ev.name}
                </Link>
              );
            })}
            {eventsInMonth.length === 0 && (
              <div style={{ padding: 30, textAlign: "center", color: "var(--ink-mute)", fontSize: 14 }}>Sin eventos en este mes</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 16, fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 14, background: "#fef3c7", border: "1.5px solid #92400e", borderRadius: 3 }} /> Bolo</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 14, background: "#dbeafe", border: "1.5px solid #1e3a8a", borderRadius: 3 }} /> Alquiler</div>
      </div>
    </div>
  );
}
