
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
