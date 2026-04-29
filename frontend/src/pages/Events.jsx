import { useEffect, useState } from "react";
import { api, formatDate } from "../lib/api";
import { Link } from "react-router-dom";
import { Plus, CalendarDays, Tag } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Calendar } from "../components/ui/calendar";
import { toast } from "sonner";

const empty = {
  name: "", type: "alquiler", client_name: "", reference: "",
  location: "", setup_date: "", event_date: "", end_date: "",
  schedule: "", notes: "",
};

export default function Events() {
  const [events, setEvents] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [tab, setTab] = useState("list");

  const load = async () => {
    const r = await api.get("/events");
    setEvents(r.data);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    try {
      await api.post("/events", form);
      toast.success("Evento creado");
      setOpen(false);
      setForm(empty);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const eventDates = events
    .filter((e) => e.event_date)
    .map((e) => new Date(e.event_date));

  return (
    <div data-testid="events-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 className="page-title">Eventos</h2>
          <p className="page-sub">{events.length} totales · {events.filter((e) => e.status === "abierto").length} abiertos</p>
        </div>
        <Button onClick={() => setOpen(true)} style={{ background: "var(--accent)" }} data-testid="new-event-btn"><Plus size={16} /> Nuevo evento</Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList style={{ marginBottom: 18 }}>
          <TabsTrigger value="list" data-testid="tab-list">Listado</TabsTrigger>
          <TabsTrigger value="cal" data-testid="tab-calendar">Calendario</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          {events.length === 0 ? (
            <div className="card-paper" style={{ textAlign: "center", padding: 60, color: "var(--ink-mute)" }}>Aún no hay eventos. Crea el primero.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {events.map((e) => (
                <Link key={e.id} to={`/eventos/${e.id}`} style={{ textDecoration: "none", color: "inherit" }} data-testid={`event-row-${e.id}`}>
                  <div className="card-paper row-hover" style={{ display: "grid", gridTemplateColumns: "1fr 160px 120px 100px", gap: 12, alignItems: "center", padding: 18 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{e.name}</span>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, padding: "2px 8px", borderRadius: 999, background: e.type === "bolo" ? "#fef3c7" : "#e0e7ff", color: e.type === "bolo" ? "#92400e" : "#3730a3", textTransform: "uppercase", letterSpacing: "0.08em" }}>{e.type}</span>
                      </div>
                      <div style={{ color: "var(--ink-mute)", fontSize: 13, marginTop: 4 }}>
                        {e.client_name || "—"} {e.reference && <><span style={{ margin: "0 6px" }}>·</span><Tag size={11} style={{ verticalAlign: "-1px" }} /> {e.reference}</>}
                      </div>
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--ink-soft)" }}>
                      <CalendarDays size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      {formatDate(e.event_date)}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{e.materials.length} stock · {e.rentals.length} alquiler</div>
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
          <div className="card-paper" style={{ display: "flex", justifyContent: "center" }}>
            <Calendar
              mode="multiple"
              selected={eventDates}
              numberOfMonths={2}
              data-testid="event-calendar"
            />
          </div>
          <div style={{ marginTop: 14, color: "var(--ink-mute)", fontSize: 13 }}>Días marcados = eventos programados.</div>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{ maxWidth: 640 }} data-testid="event-dialog">
          <DialogHeader><DialogTitle>Nuevo evento</DialogTitle></DialogHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Nombre" required>
              <Input data-testid="event-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger data-testid="event-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alquiler">Alquiler simple</SelectItem>
                  <SelectItem value="bolo">Bolo</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cliente"><Input data-testid="event-client" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></Field>
            <Field label="Nº de referencia (bolo)"><Input data-testid="event-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            <Field label="Ubicación" full><Input data-testid="event-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="Fecha montaje"><Input type="date" data-testid="event-setup" value={form.setup_date || ""} onChange={(e) => setForm({ ...form, setup_date: e.target.value })} /></Field>
            <Field label="Fecha acto"><Input type="date" data-testid="event-date" value={form.event_date || ""} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></Field>
            <Field label="Fecha fin"><Input type="date" data-testid="event-end" value={form.end_date || ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
            <Field label="Horarios"><Input data-testid="event-schedule" placeholder="Ej: Montaje 10h · Acto 20h" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} /></Field>
            <Field label="Notas" full><Textarea data-testid="event-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
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
      <label style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "JetBrains Mono, monospace", display: "block", marginBottom: 6 }}>
        {label}{required && <span style={{ color: "var(--bad)" }}> *</span>}
      </label>
      {children}
    </div>
  );
}
