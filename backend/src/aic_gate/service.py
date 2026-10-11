
from datetime import datetime
from typing import Any
from aic_gate.aws_client import read_s3_object
from aic_gate.session_store import save_session
from aic_gate.session import (
    AccessSession,
    create_session,
    get_session_status,
    revoke_session,
)
from aic_gate.validation import AccessRequest, validate_request
from aic_gate.session_store import (
    load_access_session,
    save_session,
    update_session_status,
)
_sessions: dict[str, AccessSession] = {}


def submit_access_request(request: AccessRequest) -> AccessSession:
    validate_request(request)
    session = create_session(request)

    save_session(session)
    _sessions[session.session_id] = session

    return session


def get_session(session_id: str) -> AccessSession | None:
    session = load_access_session(session_id)

    if session is None:
        _sessions.pop(session_id, None)
        return None

    _sessions[session_id] = session
    return session


def get_current_session_status(
    session_id: str,
    now: datetime | None = None,
) -> str | None:
    session = get_session(session_id)

    if session is None:
        return None

    status = get_session_status(session, now)

    if session.status != status:
        session.status = status
        update_session_status(session_id, status)

    return status


def revoke_access_session(session_id: str) -> AccessSession | None:
    session = get_session(session_id)

    if session is None:
        return None

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
