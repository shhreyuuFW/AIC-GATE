
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient

from aic_gate.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_valid_request_creates_pending_request():
    pending_request = {
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

    from unittest.mock import patch

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


def test_retrieve_existing_session():
    create_response = client.post(
        "/requests",
        json={
            "bucket": "cloudsec.proj.aicgate",
            "prefix": "logs/",
            "actions": ["s3:GetObject"],
            "duration_minutes": 30,
            "reason": "Testing retrieval",
        },
    )
    session_id = create_response.json()["session_id"]

    response = client.get(f"/sessions/{session_id}")

    assert response.status_code == 200
    assert response.json()["session_id"] == session_id
    assert response.json()["status"] == "ACTIVE"


def test_retrieve_unknown_session_returns_404():
    response = client.get("/sessions/nonexistent-session")

    assert response.status_code == 404


def test_revoke_existing_session():
    create_response = client.post(
        "/requests",
        json={
            "bucket": "cloudsec.proj.aicgate",
            "prefix": "logs/",
            "actions": ["s3:GetObject"],
            "duration_minutes": 30,
            "reason": "Testing revocation",
        },
    )
    session_id = create_response.json()["session_id"]

    response = client.post(f"/sessions/{session_id}/revoke")

    assert response.status_code == 200
    assert response.json()["status"] == "REVOKED"

    retrieved = client.get(f"/sessions/{session_id}")
    assert retrieved.json()["status"] == "REVOKED"


def test_revoke_unknown_session_returns_404():
    response = client.post("/sessions/nonexistent-session/revoke")

    assert response.status_code == 404


def test_read_object_endpoint_success():
    # Create a valid session through the API first.
    response = client.post(
        "/requests",
        json={
            "bucket": "cloudsec.proj.aicgate",
            "prefix": "logs/",
            "actions": ["s3:GetObject"],
            "duration_minutes": 15,
            "reason": "Test API object read",
        },
    )
    assert response.status_code == 200
    session_id = response.json()["session_id"]

    with patch(
        "aic_gate.main.read_session_object",
        return_value="Synthetic log content",
    ):
        response = client.get(
            f"/sessions/{session_id}/objects",
            params={"key": "logs/sample.log"},
        )

    assert response.status_code == 200
    assert response.json()["content"] == "Synthetic log content"

def test_read_object_endpoint_unknown_session():
    response = client.get(
        "/sessions/does-not-exist/objects",
        params={"key": "logs/sample.log"},
    )

    assert response.status_code == 404


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


def test_retrieve_existing_session():
    session = make_active_session()

    with (
        patch("aic_gate.main.get_session", return_value=session),
        patch(
            "aic_gate.main.get_current_session_status",
            return_value="ACTIVE",
        ),
    ):
        response = client.get("/sessions/session-test-123")

    assert response.status_code == 200
    assert response.json()["session_id"] == "session-test-123"
    assert response.json()["status"] == "ACTIVE"


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
        response = client.post(
            "/admin/requests/request-123/create-session"
        )

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
        response = client.post(
            "/admin/requests/request-123/create-session"
        )

    assert response.status_code == 403


def test_create_session_for_unknown_request_returns_404():
    with patch(
        "aic_gate.main.create_approved_session",
        side_effect=LookupError("Access request not found."),
    ):
        response = client.post(
            "/admin/requests/missing/create-session"
        )

    assert response.status_code == 404
