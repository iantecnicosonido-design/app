"""Brevo (Sendinblue) email helper. Non-blocking, with safe fallback if Brevo fails."""
import os
import base64
import logging
from typing import Optional, List, Dict, Any

import httpx

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


def _configured() -> bool:
    return bool(os.environ.get("BREVO_API_KEY"))


def _from_address() -> str:
    return os.environ.get("SENDER_EMAIL", "noreply@edisonrent.com")


def _from_name() -> str:
    return os.environ.get("SENDER_NAME", "Edison Rent")


async def send_email(
    to: str | List[str],
    subject: str,
    html: str,
    text: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """Send an email via Brevo. Returns messageId on success, None on failure.
    Never raises (errors are logged) so callers don't crash on email issues.
    attachments: list of dicts with keys 'filename' and 'content' (bytes or base64 str).
    """
    if not _configured():
        logger.warning("[EMAIL skipped] Brevo not configured. Subject=%s to=%s", subject, to)
        return None

    # Normalise recipients to list of {email, name?} dicts
    to_list = to if isinstance(to, list) else [to]
    recipients = [{"email": addr} for addr in to_list if addr]
    if not recipients:
        logger.warning("[EMAIL skipped] No recipients. Subject=%s", subject)
        return None

    payload: Dict[str, Any] = {
        "sender": {"name": _from_name(), "email": _from_address()},
        "to": recipients,
        "subject": subject,
        "htmlContent": html,
    }
    if text:
        payload["textContent"] = text
    if attachments:
        payload["attachment"] = [
            {
                "name": a["filename"],
                "content": base64.b64encode(a["content"]).decode()
                if isinstance(a["content"], (bytes, bytearray))
                else a["content"],
            }
            for a in attachments
        ]

    headers = {
        "api-key": os.environ["BREVO_API_KEY"],
        "accept": "application/json",
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(BREVO_API_URL, json=payload, headers=headers)
        if resp.status_code >= 400:
            logger.error("[EMAIL error] Brevo %s: %s subject=%s to=%s",
                         resp.status_code, resp.text, subject, to_list)
            return None
        data = resp.json() if resp.content else {}
        mid = data.get("messageId") if isinstance(data, dict) else None
        logger.info("[EMAIL sent] id=%s subject=%s to=%s", mid, subject, to_list)
        return mid
    except Exception as e:
        logger.error("[EMAIL error] %s subject=%s to=%s", e, subject, to_list)
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
          <tr><td style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#a8a29e;font-weight:600;">Edison Rent</td></tr>
          <tr><td style="padding-top:6px;font-size:22px;font-weight:700;color:#111827;">{title}</td></tr>
          <tr><td style="padding-top:18px;font-size:14px;color:#44403c;line-height:1.6;">{body_html}</td></tr>
          {cta}
          {foot}
        </table>
      </td></tr>
    </table>
    """
