
from aic_gate.session import AccessSession
from aic_gate.service import submit_access_request
import pytest
from aic_gate.session import revoke_session
from aic_gate.validation import AccessRequest
from datetime import datetime, timedelta, timezone

from aic_gate.session import (
    AccessSession,
    create_session,
    get_session_status,
)

def make_session(
    expires_at: datetime,
    status: str = "ACTIVE",
) -> AccessSession:
    now = datetime.now(timezone.utc)

    return AccessSession(
        session_id="test-session-001",
        bucket="aic-gate-lab",
        prefix="logs/",
        actions=["s3:GetObject"],
        created_at=now,
        expires_at=expires_at,
        status=status,
    )


def test_active_session_is_active():
    now = datetime.now(timezone.utc)
    session = make_session(now + timedelta(minutes=30))

    assert get_session_status(session, now) == "ACTIVE"


def test_expired_session_is_expired():
    now = datetime.now(timezone.utc)
    session = make_session(now - timedelta(minutes=1))

    assert get_session_status(session, now) == "EXPIRED"


def test_revoked_session_stays_revoked():
    now = datetime.now(timezone.utc)
    session = make_session(
        now + timedelta(minutes=30),
        status="REVOKED",
    )

    assert get_session_status(session, now) == "REVOKED"


def test_create_session_sets_expiry_and_starts_active():
    now = datetime.now(timezone.utc)

    request = AccessRequest(
        bucket="aic-gate-lab",
        prefix="logs/",
        actions=["s3:GetObject"],
        duration_minutes=30,
        reason="Testing session creation",
    )

    session = create_session(request, now)

    assert session.session_id
    assert session.bucket == "aic-gate-lab"
    assert session.prefix == "logs/"
    assert session.actions == ["s3:GetObject"]
    assert session.created_at == now
    assert session.expires_at == now + timedelta(minutes=30)
    assert session.status == "ACTIVE"


def test_active_session_can_be_revoked():
    now = datetime.now(timezone.utc)
    session = make_session(now + timedelta(minutes=30))

    revoked = revoke_session(session)

    assert revoked.status == "REVOKED"
    assert get_session_status(revoked, now) == "REVOKED"


def test_revoked_session_stays_revoked_before_expiry():
    now = datetime.now(timezone.utc)
    session = make_session(now + timedelta(minutes=30))

    revoke_session(session)

    assert get_session_status(session, now) == "REVOKED"


def make_request(**overrides) -> AccessRequest:
    values = {
        "bucket": "aic-gate-lab",
        "prefix": "logs/",
        "actions": ["s3:GetObject"],
        "duration_minutes": 30,
        "reason": "Testing the service",
    }
    values.update(overrides)
    return AccessRequest(**values)


def test_valid_request_creates_session():
    request = make_request()

    session = submit_access_request(request)

    assert isinstance(session, AccessSession)
    assert session.bucket == request.bucket
    assert session.prefix == request.prefix
    assert session.actions == request.actions
    assert session.status == "ACTIVE"


def test_invalid_request_does_not_create_session():
    request = make_request(bucket="unauthorized-bucket")

    with pytest.raises(ValueError):
        submit_access_request(request)
