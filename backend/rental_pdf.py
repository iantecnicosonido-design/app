"""PDF builders for delivery and return of alquiler-simple events."""
from datetime import datetime, timezone
from io import BytesIO
from typing import Dict, List, Optional, Any
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)
from reportlab.lib.utils import ImageReader

LOGO_PATH = Path(__file__).parent / "logo.png"

FISCAL_BLOCK = (
    "<b>EDISON RENT SL</b> · B60800301<br/>"
    "Carrer Lluis Millet, 64 · 08950 Esplugues de Llobregat, Barcelona"
)

LEGAL_NOTICE = (
    "El cliente declara recibir el material en correctas condiciones y se compromete a hacer "
    "un uso adecuado y responsable del mismo durante todo el periodo de alquiler.<br/><br/>"
    "El cliente será el único responsable de cualquier pérdida, robo, daño o deterioro ocasionado "
    "al material mientras este permanezca bajo su posesión o custodia. En caso de daño, el cliente "
    "deberá asumir el importe correspondiente a la reparación del material afectado. Si la reparación "
    "no fuese posible, el cliente deberá abonar el valor actual de mercado del equipo o elemento "
    "dañado o extraviado.<br/><br/>"
    "La firma del presente documento implica la aceptación expresa de estas condiciones."
)


def _hdr(event: dict, title: str, body):
    """Build the header block (logo + title + event meta)."""
    styles = getSampleStyleSheet()
    head_right = Paragraph(
        f"<b>{title}</b><br/>"
        f"<font size=14>{event.get('name','Evento')}</font><br/>"
        f"<font size=9 color='#78716c'>"
        + (f"{event.get('client_name','')}" if event.get('client_name') else "")
        + (f" · Ref. {event.get('reference','')}" if event.get('reference') else "")
        + "</font>",
        ParagraphStyle("hr", parent=body, fontSize=10, alignment=2),
    )
    if LOGO_PATH.exists():
        try:
            ir = ImageReader(str(LOGO_PATH))
            iw, ih = ir.getSize()
            target_w = 3.5 * cm
            target_h = target_w * (ih / iw)
            if target_h > 1.6 * cm:
                target_h = 1.6 * cm
                target_w = target_h * (iw / ih)
            logo = Image(str(LOGO_PATH), width=target_w, height=target_h)
            logo.hAlign = "LEFT"
            head = Table([[logo, head_right]], colWidths=[4 * cm, 13.5 * cm])
        except Exception:
            head = Table([["", head_right]], colWidths=[4 * cm, 13.5 * cm])
    else:
        head = Table([["", head_right]], colWidths=[4 * cm, 13.5 * cm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#1c1917")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return head


def _signature_image(file_path: Optional[str]) -> Optional[Image]:
    if not file_path:
        return None
    p = Path(file_path)
    if not p.exists():
        return None
    try:
        img = Image(str(p), width=7 * cm, height=2.5 * cm)
        img.hAlign = "LEFT"
        return img
    except Exception:
        return None


def _materials_table(event: dict, body, statuses: Optional[Dict[str, str]] = None,
                     show_status: bool = False) -> Table:
    """Materials/units table; optionally with status column (ok/nok/missing)."""
    head = ["Categoría", "Material", "Ref.", "Cantidad"]
    if show_status:
        head.append("Estado")
    rows = [head]
    style_cmds = [
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fef3c7")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#92400e")),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#e5e7eb")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]
    row_idx = 1
    statuses = statuses or {}
    for m in event.get("materials", []):
        units = m.get("units", [])
        if not units:
            continue
        for u in units:
            cells = [m.get("category", ""), m.get("name", ""), u.get("reference", ""), "1"]
            if show_status:
                st = statuses.get(u["unit_id"], "ok")
                cells.append({"ok": "OK", "nok": "NO OK", "missing": "FALTA"}.get(st, st.upper()))
                if st == "nok":
                    style_cmds.append(("BACKGROUND", (4, row_idx), (4, row_idx), colors.HexColor("#fee2e2")))
                    style_cmds.append(("TEXTCOLOR", (4, row_idx), (4, row_idx), colors.HexColor("#991b1b")))
                elif st == "missing":
                    style_cmds.append(("BACKGROUND", (4, row_idx), (4, row_idx), colors.HexColor("#fef3c7")))
                    style_cmds.append(("TEXTCOLOR", (4, row_idx), (4, row_idx), colors.HexColor("#b45309")))
                else:
                    style_cmds.append(("TEXTCOLOR", (4, row_idx), (4, row_idx), colors.HexColor("#166534")))
            rows.append(cells)
            row_idx += 1
    for r in event.get("rentals", []):
        cells = ["EXTERNO", r.get("name", ""), r.get("provider_name", "") or "—", str(r.get("quantity", 1))]
        if show_status:
            st = statuses.get(r["id"], "ok")
            cells.append({"ok": "OK", "nok": "NO OK", "missing": "FALTA"}.get(st, st.upper()))
            if st == "nok":
                style_cmds.append(("BACKGROUND", (4, row_idx), (4, row_idx), colors.HexColor("#fee2e2")))
            elif st == "missing":
                style_cmds.append(("BACKGROUND", (4, row_idx), (4, row_idx), colors.HexColor("#fef3c7")))
        rows.append(cells)
        row_idx += 1
    if len(rows) == 1:
        return None
    col_widths = [2.8 * cm, 6 * cm, 4 * cm, 2 * cm] if not show_status else [2.5 * cm, 5.2 * cm, 3.5 * cm, 1.8 * cm, 1.8 * cm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle(style_cmds))
    return t


def build_delivery_pdf(event: dict, delivery: dict, signature_path: Optional[str]) -> bytes:
    """Build the delivery (entrega) PDF. Does NOT include DNI photos."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm,
        topMargin=1.2 * cm, bottomMargin=1.6 * cm,
        title=f"Entrega {event.get('name','')}",
    )
    styles = getSampleStyleSheet()
    body = styles["Normal"]
    story = [_hdr(event, "RECIBO DE ENTREGA · ALQUILER", body), Spacer(1, 8)]

    # Meta
    delivered_at = delivery.get("delivered_at") or ""
    try:
        dt = datetime.fromisoformat(delivered_at.replace("Z", "+00:00"))
        delivered_at_fmt = dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        delivered_at_fmt = delivered_at
    deposit_str = "—"
    if delivery.get("has_deposit"):
        deposit_str = f"{float(delivery.get('deposit_amount', 0)):.2f} EUR"
    meta = [
        ["Fecha y hora entrega", delivered_at_fmt],
        ["Cliente", event.get("client_name", "—")],
        ["Contacto cliente", event.get("client_contact", "—") or "—"],
        ["Referencia", event.get("reference", "") or "—"],
        ["Ubicación", event.get("location", "") or "—"],
        ["Método de pago", (delivery.get("payment_method") or "").capitalize() or "—"],
        ["Fianza", deposit_str],
    ]
    if delivery.get("client_email"):
        meta.append(["Email cliente", delivery["client_email"]])
    mt = Table(meta, colWidths=[4 * cm, 13.5 * cm])
    mt.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#78716c")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(mt)
    story.append(Spacer(1, 12))

    story.append(Paragraph(
        "<b>MATERIAL ENTREGADO</b>",
        ParagraphStyle("ttl", parent=body, fontSize=11, textColor=colors.HexColor("#b45309"),
                       fontName="Helvetica-Bold", spaceAfter=4),
    ))
    mat_t = _materials_table(event, body)
    if mat_t:
        story.append(mat_t)
    else:
        story.append(Paragraph("(sin material registrado)", body))
    story.append(Spacer(1, 12))

    # Legal notice
    story.append(Paragraph(
        "<b>AVISO LEGAL</b>",
        ParagraphStyle("legal-h", parent=body, fontSize=10, textColor=colors.HexColor("#7f1d1d"),
                       fontName="Helvetica-Bold", spaceAfter=4),
    ))
    story.append(Paragraph(
        LEGAL_NOTICE,
        ParagraphStyle("legal", parent=body, fontSize=9, leading=12,
                       textColor=colors.HexColor("#1c1917"), spaceAfter=6),
    ))
    story.append(Paragraph(
        f"<i>El cliente declara haber leído y aceptado las condiciones anteriores el "
        f"{delivered_at_fmt}.</i>",
        ParagraphStyle("legal-foot", parent=body, fontSize=9, textColor=colors.HexColor("#78716c")),
    ))
    story.append(Spacer(1, 14))

    # Signature
    sig_img = _signature_image(signature_path)
    sig_left = sig_img if sig_img else Paragraph("(sin firma)", body)
    sig_table = Table(
        [["Firma del cliente", ""], [sig_left, ""]],
        colWidths=[9 * cm, 7 * cm], rowHeights=[0.6 * cm, 3 * cm],
    )
    sig_table.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#78716c")),
        ("LINEBELOW", (0, 1), (0, 1), 0.5, colors.HexColor("#1c1917")),
        ("VALIGN", (0, 1), (0, 1), "BOTTOM"),
    ]))
    story.append(sig_table)
    story.append(Spacer(1, 8))

    # Fiscal footer
    story.append(Paragraph(
        FISCAL_BLOCK + f"<br/><font size=8 color='#9ca3af'>Documento generado el "
        f"{datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')}</font>",
        ParagraphStyle("fis", parent=body, fontSize=9, textColor=colors.HexColor("#78716c"),
                       alignment=1, leading=11),
    ))

    doc.build(story)
    return buf.getvalue()


def build_return_pdf(event: dict, delivery: dict, return_info: dict,
                     delivery_sig_path: Optional[str], return_sig_path: Optional[str]) -> bytes:
    """Build the return PDF including item statuses (ok / nok / missing)."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm,
        topMargin=1.2 * cm, bottomMargin=1.6 * cm,
        title=f"Devolución {event.get('name','')}",
    )
    styles = getSampleStyleSheet()
    body = styles["Normal"]
    story = [_hdr(event, "ACTA DE DEVOLUCIÓN · ALQUILER", body), Spacer(1, 8)]

    delivered_at_fmt = ""
    if delivery.get("delivered_at"):
        try:
            dt = datetime.fromisoformat(delivery["delivered_at"].replace("Z", "+00:00"))
            delivered_at_fmt = dt.strftime("%d/%m/%Y %H:%M")
        except Exception:
            delivered_at_fmt = delivery["delivered_at"]
    returned_at_fmt = ""
    if return_info.get("returned_at"):
        try:
            dt = datetime.fromisoformat(return_info["returned_at"].replace("Z", "+00:00"))
            returned_at_fmt = dt.strftime("%d/%m/%Y %H:%M")
        except Exception:
            returned_at_fmt = return_info["returned_at"]
    deposit_str = "—"
    if delivery.get("has_deposit"):
        deposit_str = f"{float(delivery.get('deposit_amount', 0)):.2f} EUR"

    meta = [
        ["Cliente", event.get("client_name", "—")],
        ["Referencia", event.get("reference", "") or "—"],
        ["Fecha entrega", delivered_at_fmt or "—"],
        ["Fecha devolución", returned_at_fmt or "—"],
        ["Fianza", deposit_str],
        ["Método de pago entrega", (delivery.get("payment_method") or "").capitalize() or "—"],
    ]
    mt = Table(meta, colWidths=[4 * cm, 13.5 * cm])
    mt.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#78716c")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(mt)
    story.append(Spacer(1, 12))

    # Status map: from items list  [{id, status, note}]
    statuses: Dict[str, str] = {}
    notes: Dict[str, str] = {}
    for it in return_info.get("items", []):
        statuses[it.get("id")] = it.get("status", "ok")
        if it.get("note"):
            notes[it.get("id")] = it["note"]

    story.append(Paragraph(
        "<b>REVISIÓN DEL MATERIAL DEVUELTO</b>",
        ParagraphStyle("ttl", parent=body, fontSize=11, textColor=colors.HexColor("#b45309"),
                       fontName="Helvetica-Bold", spaceAfter=4),
    ))
    mat_t = _materials_table(event, body, statuses=statuses, show_status=True)
    if mat_t:
        story.append(mat_t)
    story.append(Spacer(1, 6))

    # Counts
    ok_n = sum(1 for s in statuses.values() if s == "ok")
    nok_n = sum(1 for s in statuses.values() if s == "nok")
    miss_n = sum(1 for s in statuses.values() if s == "missing")
    story.append(Paragraph(
        f"<b>Resumen:</b> <font color='#166534'>OK: {ok_n}</font> · "
        f"<font color='#991b1b'>NO OK: {nok_n}</font> · "
        f"<font color='#b45309'>FALTA: {miss_n}</font>",
        ParagraphStyle("sum", parent=body, fontSize=10, spaceAfter=6),
    ))

    # Notes
    if notes:
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            "<b>Notas de revisión</b>",
            ParagraphStyle("notes-h", parent=body, fontSize=10, fontName="Helvetica-Bold", spaceAfter=4),
        ))
        note_rows = [[k[:8] + "…", v] for k, v in notes.items()]
        nt = Table(note_rows, colWidths=[2 * cm, 15.5 * cm])
        nt.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#78716c")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        story.append(nt)

    story.append(Spacer(1, 12))

    # Legal notice (same)
    story.append(Paragraph(
        "<b>AVISO LEGAL</b>",
        ParagraphStyle("legal-h", parent=body, fontSize=10, textColor=colors.HexColor("#7f1d1d"),
                       fontName="Helvetica-Bold", spaceAfter=4),
    ))
    story.append(Paragraph(
        LEGAL_NOTICE,
        ParagraphStyle("legal", parent=body, fontSize=9, leading=12, spaceAfter=8),
    ))

    # Signatures: delivery (orig) + return (new)
    d_sig = _signature_image(delivery_sig_path) or Paragraph("(sin firma)", body)
    r_sig = _signature_image(return_sig_path) or Paragraph("(sin firma)", body)
    sigs = Table(
        [["Firma entrega (cliente)", "Firma devolución (cliente)"],
         [d_sig, r_sig]],
        colWidths=[8.5 * cm, 8.5 * cm],
        rowHeights=[0.6 * cm, 3 * cm],
    )
    sigs.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#78716c")),
        ("LINEBELOW", (0, 1), (-1, 1), 0.5, colors.HexColor("#1c1917")),
        ("VALIGN", (0, 1), (-1, 1), "BOTTOM"),
    ]))
    story.append(sigs)
    story.append(Spacer(1, 8))

    story.append(Paragraph(
        FISCAL_BLOCK + f"<br/><font size=8 color='#9ca3af'>Documento generado el "
        f"{datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')}</font>",
        ParagraphStyle("fis", parent=body, fontSize=9, textColor=colors.HexColor("#78716c"),
                       alignment=1, leading=11),
    ))

    doc.build(story)
    return buf.getvalue()
