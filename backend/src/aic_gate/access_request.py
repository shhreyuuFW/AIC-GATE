
"""Access request records for the AIC-GATE approval workflow."""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from aic_gate.validation import AccessRequest, validate_request


RequestStatus = Literal["PENDING", "APPROVED", "REJECTED"]


@dataclass
class AccessRequestRecord:
    request_id: str
    requester_id: str
    bucket: str
    prefix: str
    actions: list[str]
    duration_minutes: int
    reason: str
    status: RequestStatus
    created_at: datetime
    reviewed_at: datetime | None = None
    reviewed_by: str | None = None


def create_access_request(
    request: AccessRequest,
    requester_id: str,
    now: datetime | None = None,
) -> AccessRequestRecord:
    """Validate and create a pending request without issuing credentials."""

    validate_request(request)

    if not requester_id or not requester_id.strip():
        raise ValueError("Requester identity is required.")

    return AccessRequestRecord(
        request_id=str(uuid4()),
        requester_id=requester_id,
        bucket=request.bucket,
        prefix=request.prefix,
        actions=list(request.actions),
        duration_minutes=request.duration_minutes,
        reason=request.reason,
        status="PENDING",
        created_at=now or datetime.now(timezone.utc),
    )
