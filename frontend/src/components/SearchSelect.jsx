import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Button } from "./ui/button";

/**
 * SearchSelect — combobox buscable.
 * options: [{ value, label, sub?, keywords? }]
 *   - value: id
 *   - label: lo que se muestra
 *   - sub: línea secundaria opcional
 *   - keywords: string extra para indexar en la búsqueda
 * value, onChange, placeholder, allowClear, disabled, width.
 */
export default function SearchSelect({
  options = [],
  value,
  onChange,
  placeholder = "Buscar...",
  allowClear = false,
  disabled = false,
  width = "100%",
  emptyText = "Sin resultados",
  testId,
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className="justify-between font-normal"
          style={{ width, fontWeight: 400, height: 40, paddingRight: 8 }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", flex: 1, color: selected ? "var(--ink)" : "var(--ink-mute)" }}>
            {selected ? selected.label : placeholder}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {allowClear && selected && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); onChange(""); }}
                style={{ display: "inline-flex", alignItems: "center", padding: 2, borderRadius: 4 }}
                title="Limpiar"
              ><X size={14} /></span>
            )}
            <ChevronsUpDown size={14} style={{ opacity: 0.6 }} />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent style={{ width: "min(560px, 92vw)", padding: 0 }} align="start">
        <Command shouldFilter
          filter={(itemValue, search) => {
            // value here is the joined keywords string injected as item value
            return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const key = `${o.label} ${o.sub || ""} ${o.keywords || ""}`;
                return (
                  <CommandItem
                    key={o.value}
                    value={key}
                    onSelect={() => { onChange(o.value); setOpen(false); }}
                  >
                    <Check size={14} style={{ marginRight: 8, opacity: o.value === value ? 1 : 0 }} />
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</div>
                      {o.sub && <div style={{ fontSize: 11, color: "var(--ink-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.sub}</div>}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
