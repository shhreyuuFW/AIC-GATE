from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from aic_gate.audit import clear_audit_events
from aic_gate.auth import AuthenticatedUser, create_access_token
from aic_gate.main import app

client = TestClient(app)


def auth_headers(
    role: str = "requester",
    user_id: str | None = None,
) -> dict[str, str]:
    resolved_id = user_id or (
        "usr-admin-01" if role == "admin" else "usr-operator-01"
    )
    user = AuthenticatedUser(
        user_id=resolved_id,
        username="commander" if role == "admin" else "operator",
        display_name="Security Commander" if role == "admin" else "Field Operator",
        role=role,  # type: ignore[arg-type]
        department="Identity Governance" if role == "admin" else "Cloud Operations",
    )
    token, _ = create_access_token(user)
    return {"Authorization": f"Bearer {token}"}


def make_active_session(**overrides):
    now = datetime.now(timezone.utc)
    data = {
        "session_id": "session-test-123",
        "request_id": "request-test-123",
        "requester_id": "usr-operator-01",
        "bucket": "cloudsec.proj.aicgate",
        "prefix": "logs/",
        "actions": ["s3:GetObject"],
        "created_at": now,
        "expires_at": now + timedelta(minutes=30),
        "status": "ACTIVE",
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def make_pending_request(**overrides):
    data = {
        "request_id": "request-test-123",
        "requester_id": "usr-operator-01",
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


@pytest.fixture(autouse=True)
def reset_audit():
    clear_audit_events()
    yield
    clear_audit_events()


def test_health_endpoint_and_security_headers():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"


def test_login_and_me_flow():
    bad = client.post(
        "/auth/login",
        json={"username": "operator", "password": "wrong"},
    )
    assert bad.status_code == 401

    good = client.post(
        "/auth/login",
        json={"username": "operator", "password": "operator-demo-pass"},
    )
    assert good.status_code == 200
    body = good.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["role"] == "requester"

    me = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["user_id"] == "usr-operator-01"


def test_protected_endpoints_require_auth():
    assert client.post("/requests", json={}).status_code == 401
    assert client.get("/requests").status_code == 401
    assert client.get("/sessions").status_code == 401
    assert client.get("/admin/requests").status_code == 401
    assert client.get("/admin/audit").status_code == 401


def test_non_admin_cannot_access_admin_routes():
    headers = auth_headers("requester")
    assert client.get("/admin/requests", headers=headers).status_code == 403
    assert (
        client.post(
            "/admin/requests/req-1/review",
            json={"decision": "APPROVED"},
            headers=headers,
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/admin/requests/req-1/create-session",
            headers=headers,
        ).status_code
        == 403
    )
    assert client.get("/admin/audit", headers=headers).status_code == 403


def test_policy_preview_endpoint():
    response = client.post(
        "/policy/preview",
        json={
            "bucket": "cloudsec.proj.aicgate",
            "prefix": "logs/",
            "actions": ["s3:GetObject"],
        },
        headers=auth_headers("requester"),
    )
    assert response.status_code == 200
    assert response.json()["policy"]["Statement"][0]["Action"] == "s3:GetObject"

    bad = client.post(
        "/policy/preview",
        json={
            "bucket": "cloudsec.proj.aicgate",
            "prefix": "logs*",
            "actions": ["s3:GetObject"],
        },
        headers=auth_headers("requester"),
    )
    assert bad.status_code == 400


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
            headers=auth_headers("requester"),
        )

    assert response.status_code == 201
    body = response.json()
    assert body["request_id"] == "request-test-123"
    assert body["status"] == "PENDING"
    assert "credentials" not in body
    assert submit.call_args.kwargs["requester_id"] == "usr-operator-01"


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
        headers=auth_headers("requester"),
    )

    assert response.status_code == 400


def test_list_my_requests_filters_by_authenticated_requester():
    records = [make_pending_request()]
    with patch(
        "aic_gate.main.list_access_request_records",
        return_value=records,
    ) as list_records:
        response = client.get("/requests", headers=auth_headers("requester"))

    assert response.status_code == 200
    assert response.json() == {"requests": records}
    list_records.assert_called_once_with(
        status=None,
        requester_id="usr-operator-01",
    )


def test_retrieve_access_request_ownership_checks():
    own = make_pending_request(requester_id="usr-operator-01")
    other = make_pending_request(requester_id="usr-other-99")

    with patch("aic_gate.main.get_access_request_record", return_value=own):
        assert (
            client.get(
                "/requests/request-test-123",
                headers=auth_headers("requester"),
            ).status_code
            == 200
        )

    with patch("aic_gate.main.get_access_request_record", return_value=other):
        assert (
            client.get(
                "/requests/request-test-123",
                headers=auth_headers("requester"),
            ).status_code
            == 403
        )
        # Admins can inspect any request
        assert (
            client.get(
                "/requests/request-test-123",
                headers=auth_headers("admin"),
            ).status_code
            == 200
        )


def test_retrieve_access_request_not_found():
    with patch("aic_gate.main.get_access_request_record", return_value=None):
        response = client.get(
            "/requests/missing-request",
            headers=auth_headers("requester"),
        )

    assert response.status_code == 404


def test_admin_list_and_review_requests():
    records = [make_pending_request()]
    with patch(
        "aic_gate.main.list_access_request_records",
        return_value=records,
    ) as list_records:
        response = client.get(
            "/admin/requests",
            params={"status": "PENDING"},
            headers=auth_headers("admin"),
        )

    assert response.status_code == 200
    assert response.json() == {"requests": records}
    list_records.assert_called_once_with(status="PENDING")

    approved = make_pending_request(
        status="APPROVED",
        reviewed_by="usr-admin-01",
    )
    with patch(
        "aic_gate.main.review_access_request",
        return_value=approved,
    ) as review_mock:
        review_resp = client.post(
            "/admin/requests/request-test-123/review",
            json={"decision": "APPROVED"},
            headers=auth_headers("admin"),
        )

    assert review_resp.status_code == 200
    assert review_resp.json()["status"] == "APPROVED"
    assert review_mock.call_args.kwargs["reviewer_id"] == "usr-admin-01"


def test_create_session_from_approved_request_sets_no_store_and_audits():
    session = make_active_session()
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
            "/admin/requests/request-123/create-session",
            headers=auth_headers("admin"),
        )

    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["credentials"]["access_key_id"] == "TEST_ACCESS_KEY"

    audit_resp = client.get("/admin/audit", headers=auth_headers("admin"))
    assert audit_resp.status_code == 200
    events = audit_resp.json()["events"]
    assert events[0]["action"] == "SESSION_CREATED"
    assert "TEST_SECRET_KEY" not in str(events)


def test_list_sessions_scoped_by_role():
    session = make_active_session()
    with patch(
        "aic_gate.main.list_access_sessions",
        return_value=[session],
    ) as list_mock:
        req_resp = client.get("/sessions", headers=auth_headers("requester"))
        assert req_resp.status_code == 200
        assert len(req_resp.json()["sessions"]) == 1
        list_mock.assert_called_with(requester_id="usr-operator-01")

        admin_resp = client.get("/sessions", headers=auth_headers("admin"))
        assert admin_resp.status_code == 200
        list_mock.assert_called_with(requester_id=None)


def test_session_idor_prevention_and_lifecycle():
    own_session = make_active_session(requester_id="usr-operator-01")
    other_session = make_active_session(requester_id="usr-other-99")

    with patch("aic_gate.main.get_session", return_value=other_session):
        headers = auth_headers("requester")
        assert client.get("/sessions/session-test-123", headers=headers).status_code == 403
        assert client.post("/sessions/session-test-123/revoke", headers=headers).status_code == 403
        assert (
            client.get(
                "/sessions/session-test-123/objects",
                params={"key": "logs/sample.log"},
                headers=headers,
            ).status_code
            == 403
        )
        assert (
            client.post("/sessions/session-test-123/credentials", headers=headers).status_code
            == 403
        )

    revoked_session = make_active_session(status="REVOKED")
    with (
        patch("aic_gate.main.get_session", return_value=own_session),
        patch("aic_gate.main.revoke_access_session", return_value=revoked_session),
    ):
        resp = client.post(
            "/sessions/session-test-123/revoke",
            headers=auth_headers("requester"),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "REVOKED"


def test_revoke_expired_session_returns_409():
    expired_session = make_active_session(status="EXPIRED")
    with (
        patch("aic_gate.main.get_session", return_value=expired_session),
        patch(
            "aic_gate.main.revoke_access_session",
            side_effect=ValueError("Cannot revoke session with status EXPIRED."),
        ),
    ):
        resp = client.post(
            "/sessions/session-test-123/revoke",
            headers=auth_headers("requester"),
        )
        assert resp.status_code == 409


def test_issue_credentials_sets_no_store_header():
    own_session = make_active_session()
    credentials = {
        "access_key_id": "TEST_KEY",
        "secret_access_key": "TEST_SECRET",
        "session_token": "TEST_TOKEN",
        "expires_at": own_session.expires_at,
    }
    with (
        patch("aic_gate.main.get_session", return_value=own_session),
        patch("aic_gate.main.issue_session_credentials", return_value=credentials),
    ):
        resp = client.post(
            "/sessions/session-test-123/credentials",
            headers=auth_headers("requester"),
        )
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "no-store"
        assert resp.json()["access_key_id"] == "TEST_KEY"


def test_read_object_endpoint_success_and_error_mapping():
    own_session = make_active_session()
    with (
        patch("aic_gate.main.get_session", return_value=own_session),
        patch("aic_gate.main.read_session_object", return_value="Synthetic log content"),
    ):
        resp = client.get(
            "/sessions/session-test-123/objects",
            params={"key": "logs/sample.log"},
            headers=auth_headers("requester"),
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "Synthetic log content"

    with patch("aic_gate.main.get_session", side_effect=RuntimeError("DDB down")):
        resp = client.get(
            "/sessions/session-test-123/objects",
            params={"key": "logs/sample.log"},
            headers=auth_headers("requester"),
        )
        assert resp.status_code == 502
