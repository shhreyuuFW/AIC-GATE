
"""Business logic for the AIC-GATE access-request workflow."""

from datetime import datetime, timezone

from aic_gate.access_request import create_access_request
from aic_gate.identity_store import DEFAULT_LAB_ORG_ID
from aic_gate.request_store import (
    claim_approved_request,
    list_access_requests,
    load_access_request,
    record_created_session,
    release_claimed_request,
    save_access_request,
    update_access_request,
)
from aic_gate.service import submit_approved_access_session
from aic_gate.validation import AccessRequest

VALID_DECISIONS = {"APPROVED", "REJECTED"}
VALID_REQUEST_STATUSES = {
    "PENDING",
    "APPROVED",
    "REJECTED",
    "CREATING_SESSION",
    "SESSION_CREATED",
}


def submit_access_request_record(
    request: AccessRequest,
    requester_id: str,
    org_id: str = DEFAULT_LAB_ORG_ID,
):
    record = create_access_request(
        request=request,
        requester_id=requester_id,
        org_id=org_id,
    )
    save_access_request(record)
    return record


def get_access_request_record(request_id: str):
    return load_access_request(request_id)


def list_access_request_records(
    status: str | None = None,
    requester_id: str | None = None,
    org_id: str | None = None,
):
    if status is not None and status not in VALID_REQUEST_STATUSES:
        raise ValueError("Invalid request status.")

    return list_access_requests(
        status=status,
        requester_id=requester_id,
        org_id=org_id,
    )


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


def create_approved_session(request_id: str):
    """Claim an approved request and create its linked session."""
    record = load_access_request(request_id)

    if record is None:
        raise LookupError("Access request not found.")

    if record.get("status") != "APPROVED":
        raise PermissionError(
            "Access request must be approved before session creation."
        )

    if not claim_approved_request(request_id):
        raise ValueError(
            "This request is already being processed or has been used."
        )

    request = AccessRequest(
        bucket=record["bucket"],
        prefix=record["prefix"],
        actions=record["actions"],
        duration_minutes=int(record["duration_minutes"]),
        reason=record["reason"],
        service=record.get("service") or "s3",
        resource_id=record.get("resource_id"),
    )

    try:
        session, credentials = submit_approved_access_session(
            request,
            request_id=request_id,
            requester_id=record.get("requester_id"),
            org_id=record.get("org_id") or DEFAULT_LAB_ORG_ID,
        )
    except Exception:
        release_claimed_request(request_id)
        raise

    if not record_created_session(request_id, session.session_id):
        # Do not return credentials if we cannot record the linkage.
        # Issued STS credentials may remain valid until they expire.
        raise RuntimeError(
            "Session was created, but its request linkage could not be saved."
        )

    return session, credentials
