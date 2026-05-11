import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Calculator, Plus, Trash2, TrendingUp, TrendingDown, Euro, Save } from "lucide-react";
import { toast } from "sonner";

const fmt = (n) => `${(n ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export default function AccountingDialog({ open, onOpenChange, event, onChanged }) {
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetIva, setBudgetIva] = useState(21);
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceIva, setInvoiceIva] = useState(21);
  const [extra, setExtra] = useState({ kind: "gasto", concept: "", amount_excl_iva: "", iva_pct: 21 });

  useEffect(() => {
    if (!open || !event) return;
    setBudgetAmount(event.event_budget?.amount_excl_iva ?? "");
    setBudgetIva(event.event_budget?.iva_pct ?? 21);
    setInvoiceAmount(event.event_invoice?.amount_excl_iva ?? "");
    setInvoiceIva(event.event_invoice?.iva_pct ?? 21);
  }, [open, event]);

  const techExpenses = useMemo(() => (event?.tech_invoices || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0), [event]);
  const rentalExpenses = useMemo(() => (event?.rental_invoices || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0), [event]);
  const extras = event?.extra_accounting || [];
  const extraIngresos = extras.filter((e) => e.kind === "ingreso").reduce((s, e) => s + (e.amount_excl_iva || 0), 0);
  const extraGastos = extras.filter((e) => e.kind === "gasto").reduce((s, e) => s + (e.amount_excl_iva || 0), 0);

  const revenueFactura = parseFloat(invoiceAmount) || 0;
  const revenuePresupuesto = parseFloat(budgetAmount) || 0;
  const revenueDoc = revenueFactura > 0 ? revenueFactura : revenuePresupuesto;
  const revenueLabel = revenueFactura > 0 ? "factura" : (revenuePresupuesto > 0 ? "presupuesto" : null);
  const totalIngresos = revenueDoc + extraIngresos;
  const totalGastos = techExpenses + rentalExpenses + extraGastos;
  const margen = totalIngresos - totalGastos;
  const margenPct = totalIngresos > 0 ? (margen / totalIngresos * 100) : 0;

  const saveBudget = async () => {
    try {
      await api.patch(`/events/${event.id}/budget-amount`, { amount_excl_iva: parseFloat(budgetAmount) || 0, iva_pct: parseFloat(budgetIva) || 0 });
      toast.success("Presupuesto actualizado"); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };
  const saveInvoice = async () => {
    try {
      await api.patch(`/events/${event.id}/invoice-amount`, { amount_excl_iva: parseFloat(invoiceAmount) || 0, iva_pct: parseFloat(invoiceIva) || 0 });
      toast.success("Factura actualizada"); onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };
  const addExtra = async () => {
    if (!extra.concept.trim()) { toast.error("Concepto obligatorio"); return; }
    try {
      await api.post(`/events/${event.id}/extra-accounting`, {
        kind: extra.kind,
        concept: extra.concept.trim(),
        amount_excl_iva: parseFloat(extra.amount_excl_iva) || 0,
        iva_pct: parseFloat(extra.iva_pct) || 0,
      });
      setExtra({ kind: "gasto", concept: "", amount_excl_iva: "", iva_pct: 21 });
      onChanged?.();
      toast.success("Añadido");
    } catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };
  const removeExtra = async (rid) => {
    if (!window.confirm("¿Eliminar entrada?")) return;
    try { await api.delete(`/events/${event.id}/extra-accounting/${rid}`); onChanged?.(); }
    catch (e) { toast.error(e.response?.data?.detail || "Error"); }
  };

  const extraTotal = (parseFloat(extra.amount_excl_iva) || 0) * (1 + (parseFloat(extra.iva_pct) || 0) / 100);

  if (!event) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 920 }} data-testid="accounting-dialog">
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calculator size={18} /> Contabilidad · {event.name}
          </DialogTitle>
        </DialogHeader>

        {/* Resumen */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          <SummaryCard label="Ingresos" value={fmt(totalIngresos)} icon={<TrendingUp size={14} />} color="#0f766e" />
          <SummaryCard label="Gastos" value={fmt(totalGastos)} icon={<TrendingDown size={14} />} color="#b91c1c" />
          <SummaryCard label={`Margen (${margenPct.toFixed(1)}%)`} value={fmt(margen)} icon={<Euro size={14} />} color={margen >= 0 ? "#166534" : "#7f1d1d"} highlight />
        </div>

        {/* Revenue inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <RevenueRow
            title="Presupuesto" file={event.event_budget}
            amount={budgetAmount} setAmount={setBudgetAmount}
            iva={budgetIva} setIva={setBudgetIva} onSave={saveBudget}
            color="#0f766e" testid="acc-budget"
          />
          <RevenueRow
            title="Factura" file={event.event_invoice}
            amount={invoiceAmount} setAmount={setInvoiceAmount}
            iva={invoiceIva} setIva={setInvoiceIva} onSave={saveInvoice}
            color="#7c2d12" testid="acc-invoice"
          />
        </div>
        {revenueLabel && (
          <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
            Ingreso base tomado del <b>{revenueLabel}</b> · {fmt(revenueDoc)} (sin IVA)
          </div>
        )}

        {/* Auto-pulled expenses */}
        <div className="card-paper" style={{ padding: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Gastos importados de facturas subidas</div>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <Line label={`Facturas de técnicos autónomos (${(event.tech_invoices || []).length})`} amount={techExpenses} />
            <Line label={`Facturas de alquileres (${(event.rental_invoices || []).length})`} amount={rentalExpenses} />
          </div>
        </div>

        {/* Extra entries */}
        <div className="card-paper" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Entradas adicionales</div>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 80px 90px auto", gap: 6, alignItems: "center", marginBottom: 10 }}>
            <Select value={extra.kind} onValueChange={(v) => setExtra({ ...extra, kind: v })}>
              <SelectTrigger data-testid="extra-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ingreso">Ingreso</SelectItem>
                <SelectItem value="gasto">Gasto</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Concepto" value={extra.concept} onChange={(e) => setExtra({ ...extra, concept: e.target.value })} data-testid="extra-concept" />
            <Input type="number" step="0.01" placeholder="€ sin IVA" value={extra.amount_excl_iva} onChange={(e) => setExtra({ ...extra, amount_excl_iva: e.target.value })} data-testid="extra-amount" />
            <Input type="number" step="0.5" placeholder="% IVA" value={extra.iva_pct} onChange={(e) => setExtra({ ...extra, iva_pct: e.target.value })} data-testid="extra-iva" />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, textAlign: "right", color: "var(--ink-mute)" }}>{fmt(extraTotal)}</span>
            <Button onClick={addExtra} size="sm" style={{ background: "var(--accent)" }} data-testid="extra-add"><Plus size={13} /></Button>
          </div>
          {extras.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0 }}>Sin entradas adicionales.</p>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {extras.map((it) => (
                <div key={it.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 80px 100px auto", gap: 6, alignItems: "center", fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: it.kind === "ingreso" ? "#dcfce7" : "#fee2e2", color: it.kind === "ingreso" ? "#166534" : "#991b1b", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center", fontWeight: 700 }}>{it.kind}</span>
                  <span>{it.concept}</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", textAlign: "right" }}>{fmt(it.amount_excl_iva)}</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", textAlign: "right", color: "var(--ink-mute)" }}>{it.iva_pct}%</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", textAlign: "right", fontWeight: 600 }}>{fmt(it.total_incl_iva)}</span>
                  <Button size="icon" variant="ghost" onClick={() => removeExtra(it.id)}><Trash2 size={12} /></Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value, icon, color, highlight }) {
  return (
    <div className="card-paper" style={{ padding: 14, borderLeft: `3px solid ${color}`, background: highlight ? "#fefce8" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono, monospace" }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function RevenueRow({ title, file, amount, setAmount, iva, setIva, onSave, color, testid }) {
  const totalConIva = (parseFloat(amount) || 0) * (1 + (parseFloat(iva) || 0) / 100);
  return (
    <div className="card-paper" style={{ padding: 12, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontWeight: 700, fontSize: 13, color, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 8 }}>
        {file ? <span style={{ fontFamily: "JetBrains Mono, monospace" }}>{file.name}</span> : "Sin archivo subido"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 70px auto", gap: 6, alignItems: "center" }}>
        <Input type="number" step="0.01" placeholder="€ sin IVA" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`${testid}-amount`} />
        <Input type="number" step="0.5" placeholder="% IVA" value={iva} onChange={(e) => setIva(e.target.value)} data-testid={`${testid}-iva`} />
        <Button onClick={onSave} size="icon" style={{ background: color }} data-testid={`${testid}-save`}><Save size={14} /></Button>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", textAlign: "right" }}>
        Con IVA: <b>{fmt(totalConIva)}</b>
      </div>
    </div>
  );
}

function Line({ label, amount }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "var(--ink-mute)" }}>{label}</span>
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>{fmt(amount)}</span>
    </div>
  );
}
