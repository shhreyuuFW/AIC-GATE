
from datetime import datetime
from typing import Any

from aic_gate.session import (
    AccessSession,
    create_session,
    get_session_status,
    revoke_session,
)
from aic_gate.validation import AccessRequest, validate_request


_sessions: dict[str, AccessSession] = {}


def submit_access_request(request: AccessRequest) -> AccessSession:
    validate_request(request)
    session = create_session(request)
    _sessions[session.session_id] = session
    return session


def get_session(session_id: str) -> AccessSession | None:
    return _sessions.get(session_id)


def get_current_session_status(
    session_id: str,
    now: datetime | None = None,
) -> str | None:
    session = get_session(session_id)
    if session is None:
        return None

    status = get_session_status(session, now)
    session.status = status
    return status


def revoke_access_session(session_id: str) -> AccessSession | None:
    session = get_session(session_id)
    if session is None:
        return None

    revoke_session(session)
    return session
