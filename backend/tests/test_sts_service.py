
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from aic_gate.session import AccessSession
from aic_gate.service import issue_session_credentials


@pytest.fixture
def active_session():
    now = datetime.now(timezone.utc)
    return AccessSession(
        session_id="service-test-12345678",
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        created_at=now,
        expires_at=now + timedelta(minutes=30),
        status="ACTIVE",
    )


@patch("aic_gate.service.get_session")
@patch("aic_gate.service.assume_jit_role")
def test_active_session_issues_credentials(
    mock_assume,
    mock_get_session,
    active_session,
):
    mock_get_session.return_value = active_session
    mock_assume.return_value = {"access_key_id": "test"}

    result = issue_session_credentials(active_session.session_id)

    assert result == {"access_key_id": "test"}
    mock_assume.assert_called_once()


@patch("aic_gate.service.get_session")
@patch("aic_gate.service.assume_jit_role")
def test_revoked_session_cannot_issue_credentials(
    mock_assume,
    mock_get_session,
    active_session,
):
    active_session.status = "REVOKED"
    mock_get_session.return_value = active_session

    with pytest.raises(PermissionError):
        issue_session_credentials(active_session.session_id)

    mock_assume.assert_not_called()


@patch("aic_gate.service.get_session")
@patch("aic_gate.service.assume_jit_role")
def test_unknown_session_cannot_issue_credentials(
    mock_assume,
    mock_get_session,
):
    mock_get_session.return_value = None

    with pytest.raises(LookupError):
        issue_session_credentials("unknown-session")

    mock_assume.assert_not_called()


@patch("aic_gate.service.update_session_status")
@patch("aic_gate.service.get_session")
@patch("aic_gate.service.assume_jit_role")
def test_expired_session_cannot_issue_credentials(
    mock_assume,
    mock_get_session,
    mock_update_status,
    active_session,
):
    active_session.expires_at = (
        datetime.now(timezone.utc) - timedelta(seconds=1)
    )
    mock_get_session.return_value = active_session

    with pytest.raises(PermissionError, match="Session is not active"):
        issue_session_credentials(active_session.session_id)

    mock_assume.assert_not_called()
    mock_update_status.assert_called_once_with(
        active_session.session_id,
        "EXPIRED",
    )
    assert active_session.status == "EXPIRED"


@patch("aic_gate.service.get_session")
@patch("aic_gate.service.assume_jit_role")
def test_insufficient_remaining_time_is_rejected(
    mock_assume,
    mock_get_session,
    active_session,
):
    active_session.expires_at = datetime.now(
        timezone.utc) + timedelta(minutes=15)
    mock_get_session.return_value = active_session

    with pytest.raises(ValueError):
        issue_session_credentials(active_session.session_id)

    mock_assume.assert_not_called()
