"""Unit tests for secret-safe structured audit logging."""

import pytest

from aic_gate.audit import (
    clear_audit_events,
    list_audit_events,
    record_audit_event,
)


@pytest.fixture(autouse=True)
def reset_audit_buffer():
    clear_audit_events()
    yield
    clear_audit_events()


def test_record_and_list_audit_events_most_recent_first():
    record_audit_event(
        action="REQUEST_CREATED",
        actor_id="usr-operator-01",
        actor_role="requester",
        resource_id="req-1",
        outcome="SUCCESS",
        details={"prefix": "logs/"},
    )
    record_audit_event(
        action="REQUEST_REVIEWED",
        actor_id="usr-admin-01",
        actor_role="admin",
        resource_id="req-1",
        outcome="SUCCESS",
        details={"decision": "APPROVED"},
    )

    events = list_audit_events(limit=10)
    assert len(events) == 2
    assert events[0]["action"] == "REQUEST_REVIEWED"
    assert events[1]["action"] == "REQUEST_CREATED"


def test_audit_sanitizes_sensitive_keys():
    event = record_audit_event(
        action="SESSION_CREDENTIALS_ISSUED",
        actor_id="usr-operator-01",
        actor_role="requester",
        resource_id="sess-1",
        outcome="SUCCESS",
        details={
            "bucket": "cloudsec.proj.aicgate",
            "secret_access_key": "AKIA_SHOULD_NOT_APPEAR",
            "session_token": "TOKEN_SHOULD_NOT_APPEAR",
            "nested": {"password": "pw", "prefix": "logs/"},
        },
    )

    assert event.details["bucket"] == "cloudsec.proj.aicgate"
    assert event.details["secret_access_key"] == "[REDACTED]"
    assert event.details["session_token"] == "[REDACTED]"
    assert event.details["nested"]["password"] == "[REDACTED]"
    assert event.details["nested"]["prefix"] == "logs/"
