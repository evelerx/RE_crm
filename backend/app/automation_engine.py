"""Rule-based workflow automation engine for CRM events."""

from __future__ import annotations

import asyncio
import json
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Any
from uuid import UUID

import httpx
from sqlmodel import Session, select

from .models import Activity, AutomationLog, AutomationRule, Contact, Deal, User, WhatsAppMessage
from .push_service import notify_user
from .settings import settings


def _json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except Exception:  # noqa: BLE001
        return fallback


def _normalize_phone(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _parse_number(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:  # noqa: BLE001
        return None


def _render_template(template: str, payload: dict[str, Any]) -> str:
    rendered = template or ""
    for key, value in payload.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", "" if value is None else str(value))
    return rendered


def _rule_readable_actions(rule: AutomationRule) -> list[str]:
    actions = _json_loads(rule.actions_config, [])
    labels: list[str] = []
    for action in actions:
        action_type = str((action or {}).get("type") or "").strip()
        if action_type:
            labels.append(action_type)
    return labels


def _matches_filters(filters: dict[str, Any], payload: dict[str, Any]) -> bool:
    for raw_key, expected in (filters or {}).items():
        key = str(raw_key)
        actual = payload.get(key)
        if key.endswith("_lt"):
            source = payload.get(key[:-3])
            source_num = _parse_number(source)
            expected_num = _parse_number(expected)
            if source_num is None or expected_num is None or not source_num < expected_num:
                return False
            continue
        if key.endswith("_lte"):
            source = payload.get(key[:-4])
            source_num = _parse_number(source)
            expected_num = _parse_number(expected)
            if source_num is None or expected_num is None or not source_num <= expected_num:
                return False
            continue
        if key.endswith("_gt"):
            source = payload.get(key[:-3])
            source_num = _parse_number(source)
            expected_num = _parse_number(expected)
            if source_num is None or expected_num is None or not source_num > expected_num:
                return False
            continue
        if key.endswith("_gte"):
            source = payload.get(key[:-4])
            source_num = _parse_number(source)
            expected_num = _parse_number(expected)
            if source_num is None or expected_num is None or not source_num >= expected_num:
                return False
            continue
        if key.endswith("_contains"):
            source = str(payload.get(key[:-9]) or "").lower()
            if str(expected or "").lower() not in source:
                return False
            continue
        if actual is None:
            return False
        if str(actual).lower() != str(expected).lower():
            return False
    return True


async def _post_meta_message(phone: str, body: dict[str, Any]) -> str:
    send_url = f"https://graph.facebook.com/v18.0/{settings.whatsapp_phone_number_id}/messages"
    payload = {"messaging_product": "whatsapp", "to": phone, **body}
    headers = {"Authorization": f"Bearer {settings.whatsapp_token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(send_url, headers=headers, json=payload)
    if response.status_code >= 300:
        raise RuntimeError(response.text or "Meta message send failed")
    data = response.json()
    messages = data.get("messages") or []
    return str((messages[0] if messages else {}).get("id") or "")


async def _send_email(target_email: str, subject: str, body: str) -> None:
    if not (settings.smtp_host and settings.smtp_from_email):
        raise RuntimeError("SMTP email is not configured")
    message = EmailMessage()
    message["From"] = settings.smtp_from_email
    message["To"] = target_email
    message["Subject"] = subject
    message.set_content(body)
    await asyncio.to_thread(_smtp_send, message)


def _smtp_send(message: EmailMessage) -> None:
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.starttls()
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)


def _ensure_rule_log(
    session: Session,
    *,
    rule: AutomationRule,
    trigger_key: str,
) -> bool:
    if not trigger_key:
        return True
    existing = session.exec(
        select(AutomationLog).where(
            AutomationLog.rule_id == rule.id,
            AutomationLog.trigger_key == trigger_key,
        )
    ).first()
    return existing is None


def _record_log(
    session: Session,
    *,
    rule: AutomationRule,
    trigger_event: str,
    trigger_key: str,
    actions_executed: list[str],
    status: str,
    error_message: str = "",
) -> None:
    session.add(
        AutomationLog(
            rule_id=rule.id,
            owner_id=rule.owner_id,
            trigger_event=trigger_event,
            trigger_key=trigger_key,
            actions_executed=json.dumps(actions_executed),
            status=status,
            error_message=error_message,
        )
    )
    if status == "success":
        rule.run_count += 1
        rule.last_run_at = datetime.utcnow()
        rule.updated_at = datetime.utcnow()
        session.add(rule)
    session.commit()


async def _execute_action(session: Session, rule: AutomationRule, payload: dict[str, Any], action: dict[str, Any]) -> str:
    action_type = str(action.get("type") or "").strip()
    config = action.get("config") or {}

    if action_type == "create_activity":
        summary = _render_template(str(config.get("summary") or "Automation task"), payload)
        due_in_hours = int(config.get("due_in_hours") or 0)
        activity = Activity(
            owner_id=UUID(str(payload["owner_id"])),
            enterprise_owner_id=UUID(str(payload["enterprise_owner_id"])) if payload.get("enterprise_owner_id") else None,
            created_by_user_id=UUID(str(payload["owner_id"])),
            deal_id=UUID(str(payload["deal_id"])) if payload.get("deal_id") else None,
            contact_id=UUID(str(payload["contact_id"])) if payload.get("contact_id") else None,
            kind=str(config.get("kind") or "followup"),
            summary=summary[:500],
            due_at=datetime.utcnow() + timedelta(hours=due_in_hours) if due_in_hours else None,
        )
        session.add(activity)
        session.commit()
        return "create_activity"

    if action_type == "assign_deal":
        deal_id = payload.get("deal_id")
        target_user_id = config.get("user_id") or config.get("assign_to_user_id")
        if not deal_id or not target_user_id:
            raise RuntimeError("assign_deal needs deal_id and user_id")
        deal = session.get(Deal, UUID(str(deal_id)))
        target = session.get(User, UUID(str(target_user_id)))
        if not deal or not target:
            raise RuntimeError("Deal or target user not found")
        deal.created_by_user_id = target.id
        deal.updated_at = datetime.utcnow()
        session.add(deal)
        session.commit()
        await notify_user(
            session,
            target.id,
            "New deal assigned",
            f"{deal.title} was assigned to you.",
            {"deal_id": str(deal.id), "type": "deal_assigned"},
        )
        return "assign_deal"

    if action_type == "update_deal_field":
        deal_id = payload.get("deal_id")
        field_name = str(config.get("field") or "").strip()
        if not deal_id or not field_name:
            raise RuntimeError("update_deal_field needs deal_id and field")
        deal = session.get(Deal, UUID(str(deal_id)))
        if not deal or not hasattr(deal, field_name):
            raise RuntimeError("Deal field not found")
        setattr(deal, field_name, config.get("value"))
        deal.updated_at = datetime.utcnow()
        session.add(deal)
        session.commit()
        return "update_deal_field"

    if action_type == "send_whatsapp":
        contact_id = payload.get("contact_id")
        if not contact_id:
            raise RuntimeError("send_whatsapp needs contact_id")
        contact = session.get(Contact, UUID(str(contact_id)))
        if not contact:
            raise RuntimeError("Contact not found")
        phone = _normalize_phone(contact.phone)
        if not phone:
            raise RuntimeError("Contact phone missing")
        if not settings.whatsapp_token or not settings.whatsapp_phone_number_id:
            raise RuntimeError("WhatsApp Cloud API credentials are not configured")
        message_text = _render_template(str(config.get("message") or ""), payload).strip()
        if not message_text:
            raise RuntimeError("WhatsApp message is empty")
        message = WhatsAppMessage(
            owner_id=contact.owner_id,
            enterprise_owner_id=contact.enterprise_owner_id,
            contact_id=contact.id,
            deal_id=UUID(str(payload["deal_id"])) if payload.get("deal_id") else None,
            direction="outbound",
            message_body=message_text,
            status="failed",
        )
        session.add(message)
        session.commit()
        wa_message_id = await _post_meta_message(phone, {"type": "text", "text": {"body": message_text}})
        message.status = "sent"
        message.wa_message_id = wa_message_id or None
        session.add(message)
        session.commit()
        return "send_whatsapp"

    if action_type == "send_email":
        target_email = str(config.get("to") or payload.get("contact_email") or "").strip()
        subject = _render_template(str(config.get("subject") or "Northstone CRM notification"), payload)
        body = _render_template(str(config.get("body") or ""), payload)
        if not target_email:
            raise RuntimeError("send_email needs a target email")
        await _send_email(target_email, subject, body)
        return "send_email"

    if action_type == "webhook_notify":
        url = str(config.get("url") or "").strip()
        if not url:
            raise RuntimeError("webhook_notify needs a url")
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, json=payload)
        if response.status_code >= 300:
            raise RuntimeError(response.text or "Webhook notify failed")
        return "webhook_notify"

    raise RuntimeError(f"Unsupported action type: {action_type}")


async def run_automations(
    session: Session,
    *,
    owner_id: UUID,
    trigger_event: str,
    payload: dict[str, Any],
    trigger_key: str = "",
) -> None:
    """Execute all active automation rules for an owner and trigger event."""

    rows = session.exec(
        select(AutomationRule).where(
            AutomationRule.owner_id == owner_id,
            AutomationRule.trigger_event == trigger_event,
            AutomationRule.is_active == True,  # noqa: E712
        )
    ).all()
    for rule in rows:
        filters = _json_loads(rule.trigger_filters, {})
        if not _matches_filters(filters, payload):
            continue
        if not _ensure_rule_log(session, rule=rule, trigger_key=trigger_key):
            continue
        actions = _json_loads(rule.actions_config, [])
        executed: list[str] = []
        try:
            for action in actions:
                executed.append(await _execute_action(session, rule, payload, action))
            _record_log(
                session,
                rule=rule,
                trigger_event=trigger_event,
                trigger_key=trigger_key,
                actions_executed=executed,
                status="success",
            )
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            _record_log(
                session,
                rule=rule,
                trigger_event=trigger_event,
                trigger_key=trigger_key,
                actions_executed=executed or _rule_readable_actions(rule),
                status="failed",
                error_message=str(exc),
            )


async def run_overdue_activity_automations_once() -> None:
    """Scan overdue activities and run matching automation rules once per activity."""

    from .db import engine

    with Session(engine) as session:
        rules = session.exec(
            select(AutomationRule).where(
                AutomationRule.trigger_event == "activity_overdue",
                AutomationRule.is_active == True,  # noqa: E712
            )
        ).all()
        if not rules:
            return
        overdue_rows = session.exec(
            select(Activity).where(
                Activity.completed == False,  # noqa: E712
                Activity.due_at.is_not(None),
                Activity.due_at < datetime.utcnow(),
            )
        ).all()
        for activity in overdue_rows:
            owner_id = activity.enterprise_owner_id or activity.owner_id
            payload = {
                "owner_id": str(activity.owner_id),
                "enterprise_owner_id": str(activity.enterprise_owner_id) if activity.enterprise_owner_id else "",
                "activity_id": str(activity.id),
                "deal_id": str(activity.deal_id) if activity.deal_id else "",
                "contact_id": str(activity.contact_id) if activity.contact_id else "",
                "summary": activity.summary,
                "kind": activity.kind,
            }
            await run_automations(
                session,
                owner_id=owner_id,
                trigger_event="activity_overdue",
                payload=payload,
                trigger_key=f"activity_overdue:{activity.id}",
            )
