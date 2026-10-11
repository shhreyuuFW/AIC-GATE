
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from aic_gate.validation import AccessRequest
from aic_gate.service import (
    get_current_session_status,
    get_session,
    revoke_access_session,
    submit_access_request,
)


app = FastAPI(
    title="AIC-Gate",
    description="Automated Identity Controller and Just-in-Time Gateway",
    version="0.1.0",
)


class AccessRequestBody(BaseModel):
    bucket: str
    prefix: str
    actions: list[str]
    duration_minutes: int
    reason: str


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/requests")
def submit_request(body: AccessRequestBody):
    request = AccessRequest(
        bucket=body.bucket,
        prefix=body.prefix,
        actions=body.actions,
        duration_minutes=body.duration_minutes,
        reason=body.reason,
    )

    try:
        session = submit_access_request(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "session_id": session.session_id,
        "bucket": session.bucket,
        "prefix": session.prefix,
        "actions": session.actions,
        "created_at": session.created_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
        "status": session.status,
    }


@app.get("/sessions/{session_id}")
def retrieve_session(session_id: str):
    session = get_session(session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    status = get_current_session_status(session_id)

    return {
        "session_id": session.session_id,
        "bucket": session.bucket,
        "prefix": session.prefix,
        "actions": session.actions,
        "created_at": session.created_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
        "status": status,
    }


@app.post("/sessions/{session_id}/revoke")
def revoke_session_endpoint(session_id: str):
    session = revoke_access_session(session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.session_id,
        "status": session.status,
    }
