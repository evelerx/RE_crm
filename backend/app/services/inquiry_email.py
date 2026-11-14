from __future__ import annotations

from html import escape

import httpx

from ..schemas import PublicDemoRequest


class InquiryEmailError(RuntimeError):
    """Raised when a public enquiry cannot be delivered to the sales inbox."""


def _text(value: str) -> str:
    return escape(value.strip(), quote=True).replace("\n", "<br>")


def send_demo_notification(
    payload: PublicDemoRequest,
    *,
    api_key: str,
    from_email: str,
    recipient_email: str,
) -> str:
    """Send a validated landing-page enquiry through Resend and return its message ID."""
    if not api_key or not from_email or not recipient_email:
        raise InquiryEmailError("Enquiry email delivery is not configured")

    subject = f"New Northstone enquiry: {payload.full_name.strip()}"
    html = f"""
        <h2>New Northstone CRM enquiry</h2>
        <p><strong>Name:</strong> {_text(payload.full_name)}</p>
        <p><strong>Email:</strong> {_text(payload.email)}</p>
        <p><strong>Phone:</strong> {_text(payload.phone)}</p>
        <p><strong>Company:</strong> {_text(payload.company_name)}</p>
        <p><strong>City:</strong> {_text(payload.city)}</p>
        <p><strong>Plan:</strong> {_text(payload.preferred_plan)}</p>
        <p><strong>Team size:</strong> {payload.team_size}</p>
        <p><strong>Message:</strong><br>{_text(payload.message)}</p>
    """
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "from": from_email,
                "to": [recipient_email],
                "reply_to": payload.email,
                "subject": subject,
                "html": html,
            },
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        raise InquiryEmailError("Could not reach the enquiry email provider") from exc

    body = response.json() if response.content else {}
    if response.status_code >= 400:
        raise InquiryEmailError("The enquiry email provider rejected the message")

    notification_id = str(body.get("id", "")).strip() if isinstance(body, dict) else ""
    if not notification_id:
        raise InquiryEmailError("The enquiry email provider did not confirm delivery")
    return notification_id
