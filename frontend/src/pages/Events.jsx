import { useEffect, useMemo, useState } from "react";
import { api, formatDate } from "../lib/api";
import { Link, useNavigate } from "react-router-dom";
import { Plus, CalendarDays, Tag, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { toast } from "sonner";
import { useAuth, can } from "../lib/auth";

const empty = {
  name: "", type: "alquiler", client_name: "", client_contact: "", reference: "",
  location: "", setup_date: "", event_date: "", end_date: "",
  schedule: "", notes: "",
  warehouse_out_dt: "", return_dt: "",
  setup_start_dt: "", setup_end_dt: "", act_start_dt: "", act_end_dt: "",
  dismount_start_dt: "", dismount_end_dt: "",
};

const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAYS_ES = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

export default function Events() {
  const { user } = useAuth();
  const canCreate = can(user, "event_edit_ficha");
  const [events, setEvents] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [tab, setTab] = useState("list");
  const [q, setQ] = useState("");

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const load = async () => setEvents((await api.get("/events")).data);
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name.trim()) { toast.error("Nombre obligatorio"); return; }
    try { await api.post("/events", form); toast.success("Evento creado"); setOpen(false); setForm(empty); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const filtered = useMemo(() => {
    if (!q.trim()) return events;
    const Q = q.toLowerCase();
    return events.filter((e) =>
      (e.name || "").toLowerCase().includes(Q)
      || (e.client_name || "").toLowerCase().includes(Q)
      || (e.reference || "").toLowerCase().includes(Q)
      || (e.location || "").toLowerCase().includes(Q)
      || (e.event_date || "").includes(Q)
    );
  }, [events, q]);

  const isBolo = form.type === "bolo";
  return (
    <div data-testid="events-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Eventos</h2>
          <p className="page-sub">{events.length} totales · {events.filter((e) => e.status === "abierto").length} abiertos</p>
        </div>
        {canCreate && <Button onClick={() => setOpen(true)} style={{ background: "var(--accent)" }} data-testid="new-event-btn"><Plus size={16} /> Nuevo evento</Button>}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList style={{ marginBottom: 14 }}>
          <TabsTrigger value="list" data-testid="tab-list">Listado</TabsTrigger>
          <TabsTrigger value="cal" data-testid="tab-calendar">Calendario</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <div style={{ position: "relative", marginBottom: 14, maxWidth: 480 }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: "var(--ink-mute)" }} />
            <Input data-testid="event-search" placeholder="Buscar por nombre, cliente, referencia, ubicación o fecha..." value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36 }} />
          </div>
          {filtered.length === 0 ? (
            <div className="card-paper" style={{ textAlign: "center", padding: 60, color: "var(--ink-mute)" }}>{q ? "Sin resultados." : "Aún no hay eventos."}</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filtered.map((e) => (
                <Link key={e.id} to={`/eventos/${e.id}`} style={{ textDecoration: "none", color: "inherit" }} data-testid={`event-row-${e.id}`}>
                  <div className="card-paper row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 160px 120px 100px", gap: 12, alignItems: "center", padding: 16 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{e.name}</span>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, padding: "2px 8px", borderRadius: 999, background: e.type === "bolo" ? "#fef3c7" : "#e0e7ff", color: e.type === "bolo" ? "#92400e" : "#3730a3", textTransform: "uppercase", letterSpacing: "0.08em" }}>{e.type}</span>
                      </div>
                      <div style={{ color: "var(--ink-mute)", fontSize: 13, marginTop: 4 }}>
                        {e.client_name || "—"} {e.reference && <><span style={{ margin: "0 6px" }}>·</span><Tag size={11} style={{ verticalAlign: "-1px" }} /> {e.reference}</>}
                        {e.location && <><span style={{ margin: "0 6px" }}>·</span>{e.location}</>}
                      </div>
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--ink-soft)" }}>
                      <CalendarDays size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />{formatDate(e.event_date)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{e.materials.length} stock · {e.rentals.length} alq.</div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: e.status === "cerrado" ? "#fee2e2" : "#dcfce7", color: e.status === "cerrado" ? "#991b1b" : "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>{e.status}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="cal">
          <MonthCalendar year={calYear} month={calMonth} events={events}
            onPrev={() => { if (calMonth === 0) { setCalYear(calYear - 1); setCalMonth(11); } else setCalMonth(calMonth - 1); }}
            onNext={() => { if (calMonth === 11) { setCalYear(calYear + 1); setCalMonth(0); } else setCalMonth(calMonth + 1); }}
            onToday={() => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); }}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{ maxWidth: 760, maxHeight: "92vh", overflowY: "auto" }} data-testid="event-dialog">
          <DialogHeader><DialogTitle>Nuevo evento</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Nombre" required><Input data-testid="event-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Tipo">
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger data-testid="event-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alquiler">Alquiler simple</SelectItem>
                  <SelectItem value="bolo">Bolo</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cliente"><Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></Field>
            <Field label={isBolo ? "Nº referencia (bolo)" : "Contacto cliente"}>
              {isBolo
                ? <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
                : <Input placeholder="Tlf / email" value={form.client_contact} onChange={(e) => setForm({ ...form, client_contact: e.target.value })} />}
            </Field>
            <Field label="Ubicación" full><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <div style={{ gridColumn: "1 / -1", marginTop: 6, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
              <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", marginBottom: 8 }}>{isBolo ? "Cronograma del bolo" : "Salida y retorno"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {isBolo ? (
                  <>
                    <Field label="Salida nave"><Input type="datetime-local" value={form.warehouse_out_dt} onChange={(e) => setForm({ ...form, warehouse_out_dt: e.target.value })} /></Field>
                    <Field label="Fecha acto (resumen)"><Input type="date" value={form.event_date || ""} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
                    <Field label="Inicio montaje"><Input type="datetime-local" value={form.setup_start_dt} onChange={(e) => setForm({ ...form, setup_start_dt: e.target.value })} /></Field>
                    <Field label="Fin montaje"><Input type="datetime-local" value={form.setup_end_dt} onChange={(e) => setForm({ ...form, setup_end_dt: e.target.value })} /></Field>
                    <Field label="Inicio acto"><Input type="datetime-local" value={form.act_start_dt} onChange={(e) => setForm({ ...form, act_start_dt: e.target.value })} /></Field>
                    <Field label="Fin acto"><Input type="datetime-local" value={form.act_end_dt} onChange={(e) => setForm({ ...form, act_end_dt: e.target.value })} /></Field>
                    <Field label="Inicio desmontaje"><Input type="datetime-local" value={form.dismount_start_dt} onChange={(e) => setForm({ ...form, dismount_start_dt: e.target.value })} /></Field>
                    <Field label="Fin desmontaje"><Input type="datetime-local" value={form.dismount_end_dt} onChange={(e) => setForm({ ...form, dismount_end_dt: e.target.value })} /></Field>
                  </>
                ) : (
                  <>
                    <Field label="Salida nave"><Input type="datetime-local" value={form.warehouse_out_dt} onChange={(e) => setForm({ ...form, warehouse_out_dt: e.target.value })} /></Field>
                    <Field label="Retorno"><Input type="datetime-local" value={form.return_dt} onChange={(e) => setForm({ ...form, return_dt: e.target.value })} /></Field>
                    <Field label="Fecha acto (resumen)"><Input type="date" value={form.event_date || ""} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
                  </>
                )}
              </div>
            </div>
            <Field label="Horarios libres" full><Input value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} /></Field>
            <Field label="Notas" full><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create} style={{ background: "var(--accent)" }} data-testid="save-event-btn">Crear evento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children, full, required }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : "auto" }}>
      <label style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>{label}{required && <span style={{ color: "var(--bad)" }}> *</span>}</label>
      {children}
    </div>
  );
}

export function MonthCalendar({ year, month, events, onPrev, onNext, onToday, compact }) {
  const navigate = useNavigate();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const startDow = (monthStart.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const days = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= monthEnd.getDate(); d++) days.push(d);
  while (days.length % 7 !== 0) days.push(null);
  while (days.length < 42) days.push(null);

  const eventsByDay = useMemo(() => {
    const map = {};
    events.forEach((e) => {
      const start = e.warehouse_out_dt || e.setup_date || e.event_date;
      const end = e.dismount_end_dt || e.return_dt || e.end_date || e.event_date;
      if (!start) return;
      const sDate = new Date(start);
      const eDate = end ? new Date(end) : sDate;
      const cur = new Date(sDate);
      cur.setHours(0, 0, 0, 0);
      const lim = new Date(eDate);
      lim.setHours(23, 59, 59, 999);
      while (cur <= lim) {
        if (cur.getMonth() === month && cur.getFullYear() === year) {
          const d = cur.getDate();
          if (!map[d]) map[d] = [];
          map[d].push(e);
        }
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }, [events, year, month]);

  const cellHeight = compact ? 70 : 110;
  const today = new Date();

  return (
    <div className="card-paper" style={{ padding: 0, overflow: "hidden" }} data-testid="month-calendar">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="outline" size="icon" onClick={onPrev}><ChevronLeft size={16} /></Button>
          <Button variant="outline" size="icon" onClick={onNext}><ChevronRight size={16} /></Button>
          <Button variant="ghost" size="sm" onClick={onToday}>Hoy</Button>
        </div>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.02em" }}>{MONTHS_ES[month]} {year}</h3>
        <div style={{ width: 90 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--line)", background: "#faf6ef" }}>
        {DAYS_ES.map((d) => <div key={d} style={{ padding: "10px 0", textAlign: "center", fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--ink-mute)", letterSpacing: "0.1em", fontWeight: 600 }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: cellHeight }}>
        {days.map((d, idx) => {
          const isToday = d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
          const dow = idx % 7;
          const isWeekend = dow === 5 || dow === 6;
          const evs = d ? (eventsByDay[d] || []) : [];
          return (
            <div key={idx} style={{
              borderRight: ((idx + 1) % 7) ? "1px solid var(--line)" : "none",
              borderBottom: "1px solid var(--line)",
              background: !d ? "#f5efe6" : (isWeekend ? "#fbf7ee" : "#fff"),
              padding: 6, overflow: "hidden", position: "relative",
            }}>
              {d && (
                <>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "#fff" : (isWeekend ? "var(--ink-mute)" : "var(--ink-soft)"), background: isToday ? "var(--accent)" : "transparent", borderRadius: 999, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>{d}</div>
                  <div style={{ display: "grid", gap: 2 }}>
                    {evs.slice(0, compact ? 2 : 4).map((e) => (
                      <button key={e.id} onClick={() => navigate(`/eventos/${e.id}`)} title={`${e.name} · ${e.type}`} style={{
                        background: e.type === "bolo" ? "#fef3c7" : "#dbeafe",
                        color: e.type === "bolo" ? "#92400e" : "#1e3a8a",
                        border: `1px solid ${e.type === "bolo" ? "#fbbf24" : "#93c5fd"}`,
                        borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 500,
                        textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        cursor: "pointer", width: "100%",
                        opacity: e.status === "cerrado" ? 0.6 : 1,
                      }}>{e.name}</button>
                    ))}
                    {evs.length > (compact ? 2 : 4) && <div style={{ fontSize: 10, color: "var(--ink-mute)", paddingLeft: 6 }}>+ {evs.length - (compact ? 2 : 4)} más</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
