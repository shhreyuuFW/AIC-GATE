"""Secret-safe structured audit logging for AIC-GATE security events."""

from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import logging
import sys
from typing import Any, Literal
from uuid import uuid4

AuditOutcome = Literal["SUCCESS", "DENIED", "FAILED"]

_AUDIT_LOGGER = logging.getLogger("aic_gate.audit")
_AUDIT_LOGGER.setLevel(logging.INFO)
_AUDIT_LOGGER.propagate = False
if not _AUDIT_LOGGER.handlers:
    _stdout_handler = logging.StreamHandler(sys.stdout)
    _stdout_handler.setFormatter(logging.Formatter("%(message)s"))
    _AUDIT_LOGGER.addHandler(_stdout_handler)
_MAX_AUDIT_EVENTS = 500
_SENSITIVE_KEY_FRAGMENTS = (
    "secret",
    "token",
    "password",
    "credential",
)

_audit_buffer: deque["AuditEvent"] = deque(maxlen=_MAX_AUDIT_EVENTS)


@dataclass(frozen=True)
class AuditEvent:
    event_id: str
    timestamp: str
    action: str
    actor_id: str
    actor_role: str
    resource_id: str | None
    outcome: AuditOutcome
    details: dict[str, Any]


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return _sanitize_details(value)
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    return value


def _sanitize_details(details: dict[str, Any] | None) -> dict[str, Any]:
    if not details:
        return {}

    sanitized: dict[str, Any] = {}
    for key, value in details.items():
        lowered = str(key).lower()
        if any(fragment in lowered for fragment in _SENSITIVE_KEY_FRAGMENTS):
            sanitized[str(key)] = "[REDACTED]"
        else:
            sanitized[str(key)] = _sanitize_value(value)
    return sanitized


def record_audit_event(
    *,
    action: str,
    actor_id: str,
    actor_role: str,
    outcome: AuditOutcome,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    """Record a secret-safe structured audit event in memory and structured logs."""
    event = AuditEvent(
        event_id=str(uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
        action=action,
        actor_id=actor_id,
        actor_role=actor_role,
        resource_id=resource_id,
        outcome=outcome,
        details=_sanitize_details(details),
    )
    _audit_buffer.appendleft(event)
    _AUDIT_LOGGER.info(json.dumps(asdict(event), separators=(",", ":")))
    return event


def list_audit_events(limit: int = 100) -> list[dict[str, Any]]:
    """Return the most recent audit events up to `limit`."""
    clamped = max(1, min(limit, _MAX_AUDIT_EVENTS))
    return [asdict(event) for event in list(_audit_buffer)[:clamped]]


def clear_audit_events() -> None:
    """Clear the in-memory audit buffer (for test isolation)."""
    _audit_buffer.clear()
