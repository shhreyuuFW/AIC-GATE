from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from aic_gate.main import app

client = TestClient(app)


def make_active_session():
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        session_id="session-test-123",
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        created_at=now,
        expires_at=now + timedelta(minutes=30),
        status="ACTIVE",
    )


def make_pending_request(**overrides):
    data = {
        "request_id": "request-test-123",
        "requester_id": "local-dev-user",
        "bucket": "cloudsec.proj.aicgate",
        "prefix": "logs/",
        "actions": ["s3:GetObject"],
        "duration_minutes": 30,
        "reason": "Testing API request",
        "status": "PENDING",
        "created_at": "2026-10-14T12:00:00+00:00",
        "reviewed_at": None,
        "reviewed_by": None,
    }
    data.update(overrides)
    return data


def test_health_endpoint():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_valid_request_creates_pending_request():
    pending_request = make_pending_request()

    with patch(
        "aic_gate.main.submit_access_request_record",
        return_value=pending_request,
    ) as submit:
        response = client.post(
            "/requests",
            json={
                "bucket": "cloudsec.proj.aicgate",
                "prefix": "logs/",
                "actions": ["s3:GetObject"],
                "duration_minutes": 30,
                "reason": "Testing API request",
            },
        )

    assert response.status_code == 201

    body = response.json()
    assert body["request_id"] == "request-test-123"
    assert body["status"] == "PENDING"
    assert "session_id" not in body
    assert "credentials" not in body

    submit.assert_called_once()


def test_invalid_request_returns_400():
    response = client.post(
        "/requests",
        json={
            "bucket": "unauthorized-bucket",
            "prefix": "logs/",
            "actions": ["s3:GetObject"],
            "duration_minutes": 30,
            "reason": "Testing rejection",
        },
    )

    assert response.status_code == 400


def test_retrieve_access_request_success():
    record = make_pending_request()
    with patch(
        "aic_gate.main.get_access_request_record",
        return_value=record,
    ):
        response = client.get("/requests/request-test-123")

    assert response.status_code == 200
    assert response.json()["request_id"] == "request-test-123"


def test_retrieve_access_request_forbidden_for_other_user():
    record = make_pending_request(requester_id="other-user")
    with patch(
        "aic_gate.main.get_access_request_record",
        return_value=record,
    ):
        response = client.get("/requests/request-test-123")

    assert response.status_code == 403


def test_retrieve_access_request_not_found():
    with patch(
        "aic_gate.main.get_access_request_record",
        return_value=None,
    ):
        response = client.get("/requests/missing-request")

    assert response.status_code == 404


def test_admin_list_requests():
    records = [make_pending_request()]
    with patch(
        "aic_gate.main.list_access_request_records",
        return_value=records,
    ) as list_records:
        response = client.get("/admin/requests", params={"status": "PENDING"})

    assert response.status_code == 200
    assert response.json() == {"requests": records}
    list_records.assert_called_once_with(status="PENDING")


def test_admin_list_requests_invalid_status_returns_400():
    with patch(
        "aic_gate.main.list_access_request_records",
        side_effect=ValueError("Invalid request status."),
    ):
        response = client.get("/admin/requests", params={"status": "BOGUS"})

    assert response.status_code == 400


def test_admin_review_request_success():
    approved = make_pending_request(status="APPROVED", reviewed_by="local-dev-admin")
    with patch(
        "aic_gate.main.review_access_request",
        return_value=approved,
    ):
        response = client.post(
            "/admin/requests/request-test-123/review",
            json={"decision": "APPROVED"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_admin_review_request_not_found():
    with patch(
        "aic_gate.main.review_access_request",
        side_effect=LookupError("Access request not found."),
    ):
        response = client.post(
            "/admin/requests/missing/review",
            json={"decision": "APPROVED"},
        )

    assert response.status_code == 404


def test_create_session_from_approved_request():
    session = make_active_session()
    session.request_id = "request-123"

    credentials = {
        "access_key_id": "TEST_ACCESS_KEY",
        "secret_access_key": "TEST_SECRET_KEY",
        "session_token": "TEST_SESSION_TOKEN",
        "expires_at": session.expires_at,
    }

    with patch(
        "aic_gate.main.create_approved_session",
        return_value=(session, credentials),
    ):
        response = client.post("/admin/requests/request-123/create-session")

    assert response.status_code == 201
    body = response.json()
    assert body["request_id"] == "request-123"
    assert body["status"] == "ACTIVE"
    assert body["credentials"]["access_key_id"] == "TEST_ACCESS_KEY"


def test_create_session_from_pending_request_is_forbidden():
    with patch(
        "aic_gate.main.create_approved_session",
        side_effect=PermissionError(
            "Access request must be approved before session creation."
        ),
    ):
        response = client.post("/admin/requests/request-123/create-session")

    assert response.status_code == 403


def test_create_session_for_unknown_request_returns_404():
    with patch(
        "aic_gate.main.create_approved_session",
        side_effect=LookupError("Access request not found."),
    ):
        response = client.post("/admin/requests/missing/create-session")

    assert response.status_code == 404


def test_retrieve_existing_session():
    session = make_active_session()

    with patch("aic_gate.main.get_session", return_value=session) as mock_get:
        response = client.get("/sessions/session-test-123")

    assert response.status_code == 200
    assert response.json()["session_id"] == "session-test-123"
    assert response.json()["status"] == "ACTIVE"
    mock_get.assert_called_once_with("session-test-123")


def test_retrieve_unknown_session_returns_404():
    with patch("aic_gate.main.get_session", return_value=None):
        response = client.get("/sessions/nonexistent-session")

    assert response.status_code == 404


def test_revoke_existing_session():
    session = make_active_session()
    session.status = "REVOKED"

    with patch(
        "aic_gate.main.revoke_access_session",
        return_value=session,
    ):
        response = client.post("/sessions/session-test-123/revoke")

    assert response.status_code == 200
    assert response.json()["status"] == "REVOKED"


def test_revoke_unknown_session_returns_404():
    with patch("aic_gate.main.revoke_access_session", return_value=None):
        response = client.post("/sessions/nonexistent-session/revoke")

    assert response.status_code == 404


def test_read_object_endpoint_success():
    with patch(
        "aic_gate.main.read_session_object",
        return_value="Synthetic log content",
    ):
        response = client.get(
            "/sessions/session-test-123/objects",
            params={"key": "logs/sample.log"},
        )

    assert response.status_code == 200
    assert response.json()["content"] == "Synthetic log content"


def test_read_object_endpoint_unknown_session():
    with patch(
        "aic_gate.main.read_session_object",
        side_effect=LookupError("Session not found"),
    ):
        response = client.get(
            "/sessions/does-not-exist/objects",
            params={"key": "logs/sample.log"},
        )

    assert response.status_code == 404


def test_issue_credentials_endpoint_success():
    expiry = datetime.now(timezone.utc) + timedelta(minutes=25)
    credentials = {
        "access_key_id": "TEST_KEY",
        "secret_access_key": "TEST_SECRET",
        "session_token": "TEST_TOKEN",
        "expires_at": expiry,
    }
    with patch(
        "aic_gate.main.issue_session_credentials",
        return_value=credentials,
    ):
        response = client.post("/sessions/session-test-123/credentials")

    assert response.status_code == 200
    assert response.json()["access_key_id"] == "TEST_KEY"


def test_issue_credentials_endpoint_not_found():
    with patch(
        "aic_gate.main.issue_session_credentials",
        side_effect=LookupError("Session not found"),
    ):
        response = client.post("/sessions/missing/credentials")

    assert response.status_code == 404


def test_issue_credentials_endpoint_inactive_returns_403():
    with patch(
        "aic_gate.main.issue_session_credentials",
        side_effect=PermissionError("Session is not active"),
    ):
        response = client.post("/sessions/revoked/credentials")

    assert response.status_code == 403


def test_issue_credentials_endpoint_insufficient_time_returns_400():
    with patch(
        "aic_gate.main.issue_session_credentials",
        side_effect=ValueError("Insufficient session time remaining"),
    ):
        response = client.post("/sessions/expiring/credentials")

    assert response.status_code == 400
