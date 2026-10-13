
from aic_gate.request_service import create_approved_session
from unittest.mock import patch
from datetime import datetime, timezone

import pytest

from aic_gate.access_request import AccessRequestRecord
from aic_gate.request_service import (
    review_access_request,
    submit_access_request_record,
)
from aic_gate.validation import AccessRequest


@pytest.fixture
def valid_request():
    return AccessRequest(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        duration_minutes=15,
        reason="Investigate an application log.",
    )


def test_submission_creates_pending_request(
    monkeypatch, valid_request
):
    saved = []

    monkeypatch.setattr(
        "aic_gate.request_service.save_access_request",
        lambda record: saved.append(record),
    )

    record = submit_access_request_record(
        valid_request,
        requester_id="test-user",
    )

    assert record.status == "PENDING"
    assert record.requester_id == "test-user"
    assert record.request_id
    assert saved == [record]


def test_submission_rejects_missing_requester(valid_request):
    with pytest.raises(ValueError):
        submit_access_request_record(valid_request, "")


def test_review_approves_pending_request(monkeypatch):
    request_id = "request-123"
    stored = {
        "request_id": request_id,
        "status": "PENDING",
        "requester_id": "test-user",
    }
    updates = []

    monkeypatch.setattr(
        "aic_gate.request_service.load_access_request",
        lambda _request_id: stored.copy(),
    )

    def fake_update(**kwargs):
        updates.append(kwargs)
        stored["status"] = kwargs["status"]
        stored["reviewed_by"] = kwargs["reviewed_by"]
        stored["reviewed_at"] = kwargs["reviewed_at"].isoformat()
        return True

    monkeypatch.setattr(
        "aic_gate.request_service.update_access_request",
        fake_update,
    )

    result = review_access_request(
        request_id,
        "APPROVED",
        "test-admin",
    )

    assert result["status"] == "APPROVED"
    assert result["reviewed_by"] == "test-admin"
    assert len(updates) == 1
    assert updates[0]["expected_status"] == "PENDING"


def test_review_rejects_invalid_decision(monkeypatch):
    with pytest.raises(ValueError):
        review_access_request(
            "request-123",
            "MAYBE",
            "test-admin",
        )


def test_review_rejects_unknown_request(monkeypatch):
    monkeypatch.setattr(
        "aic_gate.request_service.load_access_request",
        lambda _request_id: None,
    )

    with pytest.raises(LookupError):
        review_access_request(
            "missing",
            "APPROVED",
            "test-admin",
        )


def test_review_rejects_already_reviewed_request(monkeypatch):
    monkeypatch.setattr(
        "aic_gate.request_service.load_access_request",
        lambda _request_id: {
            "request_id": "request-123",
            "status": "REJECTED",
        },
    )

    with pytest.raises(ValueError):
        review_access_request(
            "request-123",
            "APPROVED",
            "test-admin",
        )


def test_review_handles_concurrent_decision(monkeypatch):
    monkeypatch.setattr(
        "aic_gate.request_service.load_access_request",
        lambda _request_id: {
            "request_id": "request-123",
            "status": "PENDING",
        },
    )
    monkeypatch.setattr(
        "aic_gate.request_service.update_access_request",
        lambda **kwargs: False,
    )

    with pytest.raises(ValueError, match="already reviewed"):
        review_access_request(
            "request-123",
            "APPROVED",
            "test-admin",
        )


@pytest.mark.parametrize("status", ["PENDING", "REJECTED"])
def test_unapproved_request_cannot_create_session(status):
    record = {
        "request_id": "request-test-123",
        "status": status,
        "bucket": "cloudsec.proj.aicgate",
        "prefix": "logs/",
        "actions": ["s3:GetObject"],
        "duration_minutes": 15,
        "reason": "Test approval gate",
    }

    with (
        patch(
            "aic_gate.request_service.load_access_request",
            return_value=record,
        ),
        patch(
            "aic_gate.service.submit_approved_access_session"
        ) as create_session,
    ):
        with pytest.raises(PermissionError):
            create_approved_session("request-test-123")

    create_session.assert_not_called()


def test_unknown_request_cannot_create_session():
    with (
        patch(
            "aic_gate.request_service.load_access_request",
            return_value=None,
        ),
        patch(
            "aic_gate.service.submit_approved_access_session"
        ) as create_session,
    ):
        with pytest.raises(LookupError):
            create_approved_session("missing-request")

    create_session.assert_not_called()


def test_approved_request_can_create_session():
    record = {
        "request_id": "request-test-123",
        "status": "APPROVED",
        "bucket": "cloudsec.proj.aicgate",
        "prefix": "logs/",
        "actions": ["s3:GetObject"],
        "duration_minutes": 15,
        "reason": "Test approval gate",
    }

    expected_session = type("MockSession", (), {"session_id": "session-test-123"})()
    expected_result = (expected_session, {"access_key_id": "test"})

    with (
        patch(
            "aic_gate.request_service.load_access_request",
            return_value=record,
        ),
        patch(
            "aic_gate.service.submit_approved_access_session",
            return_value=expected_result,
        ) as create_session,
        patch(
            "aic_gate.request_store.claim_approved_request",
            return_value=True,
        ),
        patch(
            "aic_gate.request_store.record_created_session",
            return_value=True,
        ),
    ):
        result = create_approved_session("request-test-123")

    assert result == expected_result
    create_session.assert_called_once()


def test_approved_request_cannot_create_session_twice():
    from unittest.mock import patch
    import pytest

    record = {
        "request_id": "request-test-123",
        "status": "APPROVED",
        "bucket": "cloudsec.proj.aicgate",
        "prefix": "logs/",
        "actions": ["s3:GetObject"],
        "duration_minutes": 15,
        "reason": "Test approval gate",
    }

    with (
        patch(
            "aic_gate.request_service.load_access_request",
            return_value=record,
        ),
        patch(
            "aic_gate.request_store.claim_approved_request",
            return_value=False,
        ),
        patch(
            "aic_gate.service.submit_approved_access_session",
        ) as create_session,
    ):
        with pytest.raises(ValueError):
            create_approved_session("request-test-123")

    create_session.assert_not_called()
