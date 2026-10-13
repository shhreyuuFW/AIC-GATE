
from fastapi import FastAPI, HTTPException
from aic_gate.service import read_session_object
from pydantic import BaseModel
from aic_gate.validation import AccessRequest
from aic_gate.service import (
    get_current_session_status,
    get_session,
    revoke_access_session,
    submit_access_request,
    issue_session_credentials,
    submit_access_request_with_credentials
)
from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(
    title="AIC-Gate",
    description="Automated Identity Controller and Just-in-Time Gateway",
    version="0.1.0",
)
FRONTEND_DIR = Path(__file__).resolve().parents[3] / "frontend"

app.mount(
    "/static",
    StaticFiles(directory=str(FRONTEND_DIR)),
    name="static",
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


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(FRONTEND_DIR / "index.html")


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
        session, credentials = submit_access_request_with_credentials(
            request
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Do not expose AWS internals or credential material in errors.
        raise HTTPException(
            status_code=502,
            detail="Unable to create access session",
        ) from exc

    return {
        "session_id": session.session_id,
        "bucket": session.bucket,
        "prefix": session.prefix,
        "actions": session.actions,
        "created_at": session.created_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
        "status": session.status,
        "credentials": {
            "access_key_id": credentials["access_key_id"],
            "secret_access_key": credentials["secret_access_key"],
            "session_token": credentials["session_token"],
            "expires_at": credentials["expires_at"].isoformat(),
        },
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


@app.get("/sessions/{session_id}/objects")
def read_object(session_id: str, key: str):
    try:
        content = read_session_object(session_id, key)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    return {
        "session_id": session_id,
        "key": key,
        "content": content,
    }


@app.post("/sessions/{session_id}/credentials")
def issue_credentials(session_id: str):
    try:
        credentials = issue_session_credentials(session_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Do not return AWS internals or credentials in an error response.
        raise HTTPException(
            status_code=502,
            detail="Unable to issue temporary credentials",
        ) from exc

    return {
        "access_key_id": credentials["access_key_id"],
        "secret_access_key": credentials["secret_access_key"],
        "session_token": credentials["session_token"],
        "expires_at": credentials["expires_at"].isoformat(),
    }
