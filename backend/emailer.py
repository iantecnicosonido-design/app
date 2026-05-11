"""Resend email helper. Non-blocking, with safe fallback if Resend fails."""
import os
import asyncio
import base64
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

try:
    import resend  # type: ignore
except ImportError:
    resend = None


def _configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY") and resend is not None)


def _from_address() -> str:
    return os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")


def _from_name() -> str:
    return os.environ.get("SENDER_NAME", "Stock Eventos")


async def send_email(
    to: str | List[str],
    subject: str,
    html: str,
    text: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """Send an email via Resend. Returns email_id on success, None on failure.
    Never raises (errors are logged) so callers don't crash on email issues.
    attachments: list of dicts with keys 'filename' and 'content' (bytes).
    """
    if not _configured():
        logger.warning("[EMAIL skipped] Resend not configured. Subject=%s to=%s", subject, to)
        return None

    resend.api_key = os.environ["RESEND_API_KEY"]
    params: Dict[str, Any] = {
        "from": f"{_from_name()} <{_from_address()}>",
        "to": to if isinstance(to, list) else [to],
        "subject": subject,
        "html": html,
    }
    if text:
        params["text"] = text
    if attachments:
        params["attachments"] = [
            {
                "filename": a["filename"],
                "content": base64.b64encode(a["content"]).decode() if isinstance(a["content"], (bytes, bytearray)) else a["content"],
            }
            for a in attachments
        ]
    try:
        email = await asyncio.to_thread(resend.Emails.send, params)
        eid = email.get("id") if isinstance(email, dict) else None
        logger.info("[EMAIL sent] id=%s subject=%s to=%s", eid, subject, to)
        return eid
    except Exception as e:
        logger.error("[EMAIL error] %s subject=%s to=%s", e, subject, to)
        return None


def render_basic(title: str, body_html: str, cta_label: Optional[str] = None,
                 cta_url: Optional[str] = None, footer: Optional[str] = None) -> str:
    cta = ""
    if cta_label and cta_url:
        cta = f"""
        <tr><td style="padding:24px 0 8px 0;">
          <a href="{cta_url}" style="display:inline-block;background:#b45309;color:#fff;
             text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-family:Helvetica,Arial,sans-serif;">
             {cta_label}
          </a>
        </td></tr>"""
    foot = ""
    if footer:
        foot = f"""<tr><td style="padding-top:32px;color:#78716c;font-size:12px;font-family:Helvetica,Arial,sans-serif;">{footer}</td></tr>"""
    return f"""
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#fafaf9;padding:32px 0;font-family:Helvetica,Arial,sans-serif;">
      <tr><td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e7e5e4;">
          <tr><td style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#a8a29e;font-weight:600;">Stock · Eventos</td></tr>
          <tr><td style="padding-top:6px;font-size:22px;font-weight:700;color:#111827;">{title}</td></tr>
          <tr><td style="padding-top:18px;font-size:14px;color:#44403c;line-height:1.6;">{body_html}</td></tr>
          {cta}
          {foot}
        </table>
      </td></tr>
    </table>
    """
