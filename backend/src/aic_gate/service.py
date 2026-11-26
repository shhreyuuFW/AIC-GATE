
from datetime import datetime, timezone, timedelta

from aic_gate.aws_client import read_s3_object
from aic_gate.identity_store import DEFAULT_LAB_ORG_ID
from aic_gate.session import (
    AccessSession,
    create_session,
    get_session_status,
    revoke_session,
)
from aic_gate.session_store import (
    list_sessions,
    load_access_session,
    save_session,
    update_session_status,
)
from aic_gate.sts_client import (
    MIN_STS_DURATION_SECONDS,
    assume_jit_role,
)
from aic_gate.validation import AccessRequest, validate_request


def submit_access_request(request: AccessRequest) -> AccessSession:
    validate_request(request)
    session = create_session(request)

    save_session(session)

    return session


def submit_access_request_with_credentials(
    request: AccessRequest,
) -> tuple[AccessSession, dict]:
    """Create a session and issue credentials for its approved scope."""

    validate_request(request)
    session = create_session(request)

    duration_seconds = request.duration_minutes * 60

    # The provisional session has an active, future expiry so the
    # policy builder can validate it before STS is called.
    credentials = assume_jit_role(
        session,
        duration_seconds=duration_seconds,
    )

    credential_expiry = credentials["expires_at"]

    if credential_expiry.tzinfo is None:
        credential_expiry = credential_expiry.replace(tzinfo=timezone.utc)

    # Treat the STS expiry as the effective session expiry. The
    # approved duration starts when STS issues the credentials.
    session.expires_at = credential_expiry
    session.created_at = credential_expiry - timedelta(
        seconds=duration_seconds
    )

    # Persist before returning credentials to the caller.
    # If persistence fails, the API must not deliver the credentials.
    save_session(session)

    return session, credentials


def get_session(
    session_id: str,
    now: datetime | None = None,
) -> AccessSession | None:
    session = load_access_session(session_id)

    if session is None:
        return None

    current_time = now or datetime.now(timezone.utc)
    status = get_session_status(session, current_time)

    if session.status != status:
        session.status = status
        update_session_status(session_id, status)

    return session


def issue_session_credentials(
    session_id: str,
    now: datetime | None = None,
) -> dict:
    """Issue temporary AWS credentials for an active persisted session."""

    session = get_session(session_id, now=now)

    if session is None:
        raise LookupError("Session not found")

    current_time = now or datetime.now(timezone.utc)
    status = get_session_status(session, current_time)

    if status != "ACTIVE":
        if session.status != status:
            session.status = status
            update_session_status(session_id, status)
        raise PermissionError("Session is not active")

    remaining_seconds = int(
        (session.expires_at - current_time).total_seconds()
    )

    if remaining_seconds < MIN_STS_DURATION_SECONDS:
        raise ValueError(
            "Insufficient session time remaining for STS credentials. "
            "Create a new access session."
        )

    # Leave a small safety margin so credentials do not outlive
    # the application's session expiry due to request timing.
    duration_seconds = remaining_seconds - 5

    if duration_seconds < MIN_STS_DURATION_SECONDS:
        raise ValueError(
            "Insufficient session time remaining for STS credentials. "
            "Create a new access session."
        )

    return assume_jit_role(
        session,
        duration_seconds=duration_seconds,
    )


def get_current_session_status(
    session_id: str,
    now: datetime | None = None,
) -> str | None:
    session = get_session(session_id, now=now)

    if session is None:
        return None

    return get_session_status(session, now)


def list_access_sessions(
    requester_id: str | None = None,
    org_id: str | None = None,
    now: datetime | None = None,
) -> list[AccessSession]:
    """List sessions and lazily reconcile any newly expired records."""
    sessions = list_sessions(requester_id=requester_id, org_id=org_id)
    current_time = now or datetime.now(timezone.utc)

    for session in sessions:
        status = get_session_status(session, current_time)
        if session.status != status:
            session.status = status
            update_session_status(session.session_id, status)

    return sessions


def revoke_access_session(session_id: str) -> AccessSession | None:
    session = get_session(session_id)

    if session is None:
        return None

    if session.status != "ACTIVE":
        raise ValueError(
            f"Cannot revoke session with status {session.status}."
        )

    revoke_session(session)
    update_session_status(session_id, "REVOKED")

    return session


def read_session_object(
    session_id: str,
    key: str,
    now: datetime | None = None,
) -> str:
    session = get_session(session_id)

    if session is None:
        raise LookupError("Session not found")

    status = get_session_status(session, now)

    if status != "ACTIVE":
        if session.status != status:
            session.status = status
            update_session_status(session_id, status)
        raise PermissionError("Session is not active")

    if "s3:GetObject" not in session.actions:
        raise PermissionError("Session does not permit object reads")

    prefix = session.prefix.strip("/")

    if (
        not key
        or key.startswith("/")
        or "\\" in key
        or any(part in ("", ".", "..") for part in key.split("/"))
    ):
        raise PermissionError("Invalid object key")

    if not key.startswith(prefix + "/"):
        raise PermissionError("Object is outside the authorized prefix")

    return read_s3_object(session.bucket, key)


def submit_approved_access_session(
    request: AccessRequest,
    request_id: str,
    requester_id: str | None = None,
    org_id: str = DEFAULT_LAB_ORG_ID,
) -> tuple[AccessSession, dict]:
    """Create a session linked to an approved access request."""
    if not request_id or not request_id.strip():
        raise ValueError("An approved request ID is required.")

    validate_request(request)
    session = create_session(
        request,
        request_id=request_id,
        requester_id=requester_id,
        org_id=org_id,
    )

    duration_seconds = request.duration_minutes * 60
    credentials = assume_jit_role(
        session,
        duration_seconds=duration_seconds,
    )

    credential_expiry = credentials["expires_at"]
    if credential_expiry.tzinfo is None:
        credential_expiry = credential_expiry.replace(
            tzinfo=timezone.utc
        )

    session.expires_at = credential_expiry
    session.created_at = credential_expiry - timedelta(
        seconds=duration_seconds
    )

    # Persist before returning credentials to the caller.
    save_session(session)

    return session, credentials
