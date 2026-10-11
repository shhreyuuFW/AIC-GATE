
from fastapi.testclient import TestClient

from aic_gate.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_valid_request_returns_created_session():
    response = client.post(
        "/requests",
        json={
            "bucket": "aic-gate-lab",
            "prefix": "logs/",
            "actions": ["s3:GetObject"],
            "duration_minutes": 30,
            "reason": "Testing API request",
        },
    )

    assert response.status_code == 200

    body = response.json()
    assert body["bucket"] == "aic-gate-lab"
    assert body["prefix"] == "logs/"
    assert body["actions"] == ["s3:GetObject"]
    assert body["status"] == "ACTIVE"
    assert body["session_id"]


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
            "bucket": "aic-gate-lab",
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
            "bucket": "aic-gate-lab",
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
