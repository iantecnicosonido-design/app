import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Trash2, X } from "lucide-react";
import { api } from "../lib/api";

export default function NotificationBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/notifications", { params: { limit: 30 } });
      setItems(r.data.items || []);
      setUnread(r.data.unread || 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // poll cada 30s
    return () => clearInterval(id);
  }, [load]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleClick = async (n) => {
    if (!n.read) {
      try { await api.post(`/notifications/${n.id}/read`); } catch { /* silent */ }
    }
    setOpen(false);
    if (n.link) nav(n.link);
    load();
  };

  const markAll = async () => {
    try { await api.post("/notifications/read-all"); load(); } catch { /* silent */ }
  };

  const remove = async (e, n) => {
    e.stopPropagation();
    try { await api.delete(`/notifications/${n.id}`); load(); } catch { /* silent */ }
  };

  return (
    <div ref={ref} style={{ position: "relative" }} data-testid="notification-bell">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="notif-bell-btn"
        style={{
          position: "relative",
          background: "transparent",
          border: "1px solid var(--sidebar-line)",
          color: "#fafaf9",
          padding: "6px 10px",
          borderRadius: 6,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontFamily: "inherit",
          width: "100%",
          justifyContent: "flex-start",
        }}
      >
        <Bell size={13} />
        <span>Notificaciones</span>
        {unread > 0 && (
          <span
            data-testid="notif-unread-badge"
            style={{
              marginLeft: "auto",
              background: "var(--bad)",
              color: "#fff",
              borderRadius: 999,
              fontSize: 10,
              padding: "1px 7px",
              fontWeight: 700,
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notif-dropdown"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "#fff",
            color: "#111827",
            borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            border: "1px solid var(--line)",
            zIndex: 1000,
            maxHeight: 420,
            display: "flex",
            flexDirection: "column",
            minWidth: 320,
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Notificaciones {unread > 0 && <span style={{ color: "var(--bad)" }}>({unread})</span>}
            </span>
            {unread > 0 && (
              <button onClick={markAll} data-testid="notif-mark-all" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "inherit" }}>
                <Check size={12} /> Marcar todas
              </button>
            )}
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {items.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--ink-mute)", fontSize: 12 }}>
                Sin notificaciones
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  data-testid={`notif-item-${n.id}`}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line)",
                    cursor: n.link ? "pointer" : "default",
                    background: n.read ? "transparent" : "#fff7ed",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  {!n.read && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", flexShrink: 0, marginTop: 6 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: n.message }} />
                    <div style={{ fontSize: 9, color: "var(--ink-mute)", fontFamily: "JetBrains Mono, monospace", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {new Date(n.created_at).toLocaleString("es-ES")}
                    </div>
                  </div>
                  <button onClick={(e) => remove(e, n)} title="Eliminar" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-mute)", padding: 2 }}>
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
