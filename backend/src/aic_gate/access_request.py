"""Access request records for the AIC-GATE approval workflow."""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from aic_gate.identity_store import DEFAULT_LAB_ORG_ID
from aic_gate.validation import (
    AccessRequest,
    compute_risk_level,
    validate_request,
)

RequestStatus = Literal[
    "PENDING",
    "APPROVED",
    "REJECTED",
    "CREATING_SESSION",
    "SESSION_CREATED",
]


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
    org_id: str = DEFAULT_LAB_ORG_ID
    service: str = "s3"
    resource_id: str | None = None
    risk_level: str = "LOW"


def create_access_request(
    request: AccessRequest,
    requester_id: str,
    now: datetime | None = None,
    org_id: str = DEFAULT_LAB_ORG_ID,
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
        org_id=org_id,
        service=request.service,
        resource_id=request.resource_id,
        risk_level=compute_risk_level(
            request.service,
            request.actions,
            request.duration_minutes,
        ),
    )
