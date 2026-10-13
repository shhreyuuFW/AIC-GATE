
"""Business logic for the AIC-GATE access-request workflow."""

from datetime import datetime, timezone

from aic_gate.access_request import create_access_request
from aic_gate.request_store import (
    list_access_requests,
    load_access_request,
    save_access_request,
    update_access_request,
)
from aic_gate.validation import AccessRequest


VALID_DECISIONS = {"APPROVED", "REJECTED"}


def submit_access_request_record(
    request: AccessRequest,
    requester_id: str,
):
    record = create_access_request(
        request=request,
        requester_id=requester_id,
    )
    save_access_request(record)
    return record


def get_access_request_record(request_id: str):
    return load_access_request(request_id)


def list_access_request_records(status: str | None = None):
    if status is not None and status not in {
        "PENDING",
        "APPROVED",
        "REJECTED",
    }:
        raise ValueError("Invalid request status.")

    return list_access_requests(status=status)


def review_access_request(
    request_id: str,
    decision: str,
    reviewer_id: str,
):
    if decision not in VALID_DECISIONS:
        raise ValueError("Decision must be APPROVED or REJECTED.")

    if not reviewer_id or not reviewer_id.strip():
        raise ValueError("Reviewer identity is required.")

    existing = load_access_request(request_id)
    if existing is None:
        raise LookupError("Access request not found.")

    if existing.get("status") != "PENDING":
        raise ValueError("Only pending requests can be reviewed.")

    updated = update_access_request(
        request_id=request_id,
        status=decision,
        reviewed_by=reviewer_id,
        reviewed_at=datetime.now(timezone.utc),
        expected_status="PENDING",
    )

    if not updated:
        raise ValueError(
            "This request was already reviewed. Refresh the request list."
        )

    return load_access_request(request_id)
