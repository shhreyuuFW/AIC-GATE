
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from aic_gate.request_service import (
    submit_access_request_record,
    get_access_request_record,
    list_access_request_records,
    review_access_request,
    create_approved_session,
)
from aic_gate.validation import AccessRequest
from aic_gate.request_service import (
    submit_access_request_record,
    get_access_request_record,
    list_access_request_records,
    review_access_request,
)
from aic_gate.service import (
    get_current_session_status,
    get_session,
    revoke_access_session,
    issue_session_credentials,
    read_session_object,
)

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

# TEMPORARY LOCAL-DEVELOPMENT IDENTITIES ONLY.
# Replace with identities from verified authentication before deployment.
DEV_REQUESTER_ID = "local-dev-user"
DEV_ADMIN_ID = "local-dev-admin"


class AccessRequestBody(BaseModel):
    bucket: str
    prefix: str
    actions: list[str]
    duration_minutes: int
    reason: str


class ReviewBody(BaseModel):
    decision: str


def request_to_dict(record):
    """Serialize a request dataclass or DynamoDB item."""
    if isinstance(record, dict):
        return record

    return {
        "request_id": record.request_id,
        "requester_id": record.requester_id,
        "bucket": record.bucket,
        "prefix": record.prefix,
        "actions": record.actions,
        "duration_minutes": record.duration_minutes,
        "reason": record.reason,
        "status": record.status,
        "created_at": record.created_at.isoformat(),
        "reviewed_at": (
            record.reviewed_at.isoformat()
            if record.reviewed_at
            else None
        ),
        "reviewed_by": record.reviewed_by,
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/requests", status_code=201)
def submit_request(body: AccessRequestBody):
    request = AccessRequest(
        bucket=body.bucket,
        prefix=body.prefix,
        actions=body.actions,
        duration_minutes=body.duration_minutes,
        reason=body.reason,
    )

    try:
        record = submit_access_request_record(
            request,
            requester_id=DEV_REQUESTER_ID,
        )
        return request_to_dict(record)

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to submit access request",
        ) from exc


@app.get("/requests/{request_id}")
def retrieve_access_request(request_id: str):
    try:
        record = get_access_request_record(request_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve access request",
        ) from exc

    if record is None:
        raise HTTPException(
            status_code=404,
            detail="Access request not found",
        )

    # Local-development placeholder. Enforce real ownership using
    # the authenticated principal before public deployment.
    data = request_to_dict(record)
    if data.get("requester_id") != DEV_REQUESTER_ID:
        raise HTTPException(status_code=403, detail="Forbidden")

    return data


@app.get("/admin/requests")
def admin_list_requests(status: str | None = None):
    try:
        records = list_access_request_records(status=status)
        return {"requests": [request_to_dict(item) for item in records]}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to list access requests",
        ) from exc


@app.post("/admin/requests/{request_id}/review")
def admin_review_request(request_id: str, body: ReviewBody):
    try:
        record = review_access_request(
            request_id=request_id,
            decision=body.decision,
            reviewer_id=DEV_ADMIN_ID,
        )
        return request_to_dict(record)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to review access request",
        ) from exc


@app.post("/admin/requests/{request_id}/create-session", status_code=201)
def create_session_from_approved_request(request_id: str):
    try:
        session, credentials = create_approved_session(request_id)

        return {
            "session_id": session.session_id,
            "request_id": session.request_id,
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

    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to create session from approved request",
        ) from exc


@app.post("/admin/requests/{request_id}/create-session", status_code=201)
def create_session_from_approved_request(request_id: str):
    try:
        session, credentials = create_approved_session(request_id)

        return {
            "session_id": session.session_id,
            "request_id": session.request_id,
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

    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to create session from approved request",
        ) from exc


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
