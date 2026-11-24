
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from aic_gate.service import submit_access_request_with_credentials
from aic_gate.validation import AccessRequest


def make_request():
    return AccessRequest(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject", "s3:ListBucket"],
        duration_minutes=30,
        reason="Test temporary access",
    )


@patch("aic_gate.service.save_session")
@patch("aic_gate.service.assume_jit_role")
def test_request_issues_and_persists_credentials(
    mock_assume,
    mock_save,
):
    expiry = datetime.now(timezone.utc) + timedelta(minutes=30)
    mock_assume.return_value = {
        "access_key_id": "test-access-key",
        "secret_access_key": "test-secret",
        "session_token": "test-token",
        "expires_at": expiry,
    }

    session, credentials = submit_access_request_with_credentials(
        make_request()
    )

    assert session.status == "ACTIVE"
    assert session.expires_at == expiry
    assert credentials["access_key_id"] == "test-access-key"
    mock_save.assert_called_once()


@patch("aic_gate.service.save_session")
@patch("aic_gate.service.assume_jit_role")
def test_request_does_not_persist_if_sts_fails(
    mock_assume,
    mock_save,
):
    mock_assume.side_effect = RuntimeError("STS unavailable")

    try:
        submit_access_request_with_credentials(make_request())
    except RuntimeError:
        pass
    else:
        raise AssertionError("Expected STS failure")

    mock_save.assert_not_called()


@patch("aic_gate.service.save_session")
@patch("aic_gate.service.assume_jit_role")
def test_request_does_not_return_credentials_if_persistence_fails(
    mock_assume,
    mock_save,
):
    expiry = datetime.now(timezone.utc) + timedelta(minutes=30)
    mock_assume.return_value = {
        "access_key_id": "test-access-key",
        "secret_access_key": "test-secret",
        "session_token": "test-token",
        "expires_at": expiry,
    }
    mock_save.side_effect = RuntimeError("DynamoDB unavailable")

    try:
        submit_access_request_with_credentials(make_request())
    except RuntimeError:
        pass
    else:
        raise AssertionError("Expected persistence failure")
