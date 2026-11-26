
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from aic_gate.identity_store import DEFAULT_LAB_ORG_ID
from aic_gate.validation import AccessRequest

SessionStatus = Literal["ACTIVE", "EXPIRED", "REVOKED"]


@dataclass
class AccessSession:
    session_id: str
    bucket: str
    prefix: str
    actions: list[str]
    created_at: datetime
    expires_at: datetime
    status: SessionStatus = "ACTIVE"
    request_id: str | None = None
    requester_id: str | None = None
    org_id: str = DEFAULT_LAB_ORG_ID
    service: str = "s3"
    resource_id: str | None = None


def create_session(
    request: AccessRequest,
    now: datetime | None = None,
    request_id: str | None = None,
    requester_id: str | None = None,
    org_id: str = DEFAULT_LAB_ORG_ID,
) -> AccessSession:
    created_at = now or datetime.now(timezone.utc)

    return AccessSession(
        session_id=str(uuid4()),
        bucket=request.bucket,
        prefix=request.prefix,
        actions=list(request.actions),
        created_at=created_at,
        expires_at=created_at + timedelta(
            minutes=request.duration_minutes
        ),
        status="ACTIVE",
        request_id=request_id,
        requester_id=requester_id,
        org_id=org_id,
        service=request.service,
        resource_id=request.resource_id,
    )


def get_session_status(
    session: AccessSession,
    now: datetime | None = None,
) -> SessionStatus:
    if session.status in ("REVOKED", "EXPIRED"):
        return session.status

    current_time = now or datetime.now(timezone.utc)

    if current_time >= session.expires_at:
        return "EXPIRED"

    return "ACTIVE"


def revoke_session(session: AccessSession) -> AccessSession:
    session.status = "REVOKED"
    return session
