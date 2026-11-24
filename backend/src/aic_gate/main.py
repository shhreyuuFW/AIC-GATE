from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from aic_gate.audit import list_audit_events, record_audit_event
from aic_gate.auth import (
    AuthenticatedUser,
    authenticate_user,
    create_access_token,
    get_current_user,
    require_admin,
)
from aic_gate.config import get_settings
from aic_gate.request_service import (
    create_approved_session,
    get_access_request_record,
    list_access_request_records,
    review_access_request,
    submit_access_request_record,
)
from aic_gate.service import (
    get_session,
    issue_session_credentials,
    list_access_sessions,
    read_session_object,
    revoke_access_session,
)
from aic_gate.session import AccessSession
from aic_gate.sts_client import preview_session_policy
from aic_gate.validation import AccessRequest

settings = get_settings()

app = FastAPI(
    title="AIC-Gate",
    description="Automated Identity Controller and Just-in-Time Gateway",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


FRONTEND_DIST_DIR = Path(__file__).resolve().parents[3] / "frontend" / "dist"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"
if FRONTEND_ASSETS_DIR.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_ASSETS_DIR)),
        name="assets",
    )


class LoginBody(BaseModel):
    username: str
    password: str


class AccessRequestBody(BaseModel):
    bucket: str
    prefix: str
    actions: list[str]
    duration_minutes: int
    reason: str


class PolicyPreviewBody(BaseModel):
    bucket: str
    prefix: str
    actions: list[str]


class ReviewBody(BaseModel):
    decision: str


def _user_to_dict(user: AuthenticatedUser) -> dict:
    return {
        "user_id": user.user_id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "department": user.department,
    }


def _request_to_dict(record) -> dict:
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
            record.reviewed_at.isoformat() if record.reviewed_at else None
        ),
        "reviewed_by": record.reviewed_by,
    }


def _session_to_dict(session: AccessSession) -> dict:
    return {
        "session_id": session.session_id,
        "request_id": session.request_id,
        "requester_id": session.requester_id,
        "bucket": session.bucket,
        "prefix": session.prefix,
        "actions": session.actions,
        "created_at": session.created_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
        "status": session.status,
    }


def _ensure_session_access(
    session: AccessSession,
    user: AuthenticatedUser,
) -> None:
    if user.role != "admin" and session.requester_id != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")


@app.get("/health")
def health_check():
    return {"status": "ok"}


def _serve_spa_index():
    index_path = FRONTEND_DIST_DIR / "index.html"
    if not index_path.is_file():
        raise HTTPException(status_code=404, detail="Frontend not built")
    return FileResponse(index_path)


@app.get("/", include_in_schema=False)
@app.get("/login", include_in_schema=False)
@app.get("/client", include_in_schema=False)
@app.get("/client/{path:path}", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
@app.get("/admin/sessions", include_in_schema=False)
@app.get("/admin/graph", include_in_schema=False)
@app.get("/admin/audit-log", include_in_schema=False)
@app.get("/admin/guide", include_in_schema=False)
def frontend(path: str = ""):
    del path
    return _serve_spa_index()


@app.post("/auth/login")
def login(body: LoginBody):
    user = authenticate_user(body.username, body.password)
    if user is None:
        record_audit_event(
            action="AUTH_LOGIN_FAILED",
            actor_id=body.username.strip() or "anonymous",
            actor_role="unknown",
            outcome="DENIED",
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )

    token, expires_in = create_access_token(user)
    record_audit_event(
        action="AUTH_LOGIN_SUCCESS",
        actor_id=user.user_id,
        actor_role=user.role,
        outcome="SUCCESS",
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "user": _user_to_dict(user),
    }


@app.get("/auth/me")
def get_me(user: AuthenticatedUser = Depends(get_current_user)):
    return _user_to_dict(user)


@app.post("/policy/preview")
def preview_policy(
    body: PolicyPreviewBody,
    _user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        policy = preview_session_policy(
            bucket=body.bucket,
            prefix=body.prefix,
            actions=body.actions,
        )
        return {"policy": policy}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/requests", status_code=201)
def submit_request(
    body: AccessRequestBody,
    user: AuthenticatedUser = Depends(get_current_user),
):
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
            requester_id=user.user_id,
        )
        data = _request_to_dict(record)
        record_audit_event(
            action="REQUEST_CREATED",
            actor_id=user.user_id,
            actor_role=user.role,
            resource_id=data.get("request_id"),
            outcome="SUCCESS",
            details={
                "bucket": body.bucket,
                "prefix": body.prefix,
                "actions": body.actions,
                "duration_minutes": body.duration_minutes,
            },
        )
        return data

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to submit access request",
        ) from exc


@app.get("/requests")
def list_my_requests(
    status: str | None = None,
    user: AuthenticatedUser = Depends(get_current_user),
):
    requester_filter = None if user.role == "admin" else user.user_id
    try:
        records = list_access_request_records(
            status=status,
            requester_id=requester_filter,
        )
        return {"requests": [_request_to_dict(item) for item in records]}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to list access requests",
        ) from exc


@app.get("/requests/{request_id}")
def retrieve_access_request(
    request_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
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

    data = _request_to_dict(record)
    if user.role != "admin" and data.get("requester_id") != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    return data


@app.get("/admin/requests")
def admin_list_requests(
    status: str | None = None,
    _admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        records = list_access_request_records(status=status)
        return {"requests": [_request_to_dict(item) for item in records]}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to list access requests",
        ) from exc


@app.post("/admin/requests/{request_id}/review")
def admin_review_request(
    request_id: str,
    body: ReviewBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        record = review_access_request(
            request_id=request_id,
            decision=body.decision,
            reviewer_id=admin.user_id,
        )
        record_audit_event(
            action="REQUEST_REVIEWED",
            actor_id=admin.user_id,
            actor_role=admin.role,
            resource_id=request_id,
            outcome="SUCCESS",
            details={"decision": body.decision},
        )
        return _request_to_dict(record)
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
def create_session_from_approved_request(
    request_id: str,
    response: Response,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        session, credentials = create_approved_session(request_id)
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

    response.headers["Cache-Control"] = "no-store"
    record_audit_event(
        action="SESSION_CREATED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=session.session_id,
        outcome="SUCCESS",
        details={
            "request_id": request_id,
            "bucket": session.bucket,
            "prefix": session.prefix,
        },
    )

    return {
        "session_id": session.session_id,
        "request_id": session.request_id,
        "requester_id": session.requester_id,
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


@app.get("/admin/audit")
def admin_list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    _admin: AuthenticatedUser = Depends(require_admin),
):
    return {"events": list_audit_events(limit=limit)}


@app.get("/sessions")
def list_sessions_endpoint(
    user: AuthenticatedUser = Depends(get_current_user),
):
    requester_filter = None if user.role == "admin" else user.user_id
    try:
        sessions = list_access_sessions(requester_id=requester_filter)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to list access sessions",
        ) from exc

    return {"sessions": [_session_to_dict(item) for item in sessions]}


@app.get("/sessions/{session_id}")
def retrieve_session(
    session_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        session = get_session(session_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve access session",
        ) from exc

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    _ensure_session_access(session, user)
    return _session_to_dict(session)


@app.post("/sessions/{session_id}/revoke")
def revoke_session_endpoint(
    session_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        existing = get_session(session_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve access session",
        ) from exc

    if existing is None:
        raise HTTPException(status_code=404, detail="Session not found")

    _ensure_session_access(existing, user)

    try:
        session = revoke_access_session(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to revoke access session",
        ) from exc

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    record_audit_event(
        action="SESSION_REVOKED",
        actor_id=user.user_id,
        actor_role=user.role,
        resource_id=session.session_id,
        outcome="SUCCESS",
    )

    return {
        "session_id": session.session_id,
        "status": session.status,
    }


@app.get("/sessions/{session_id}/objects")
def read_object(
    session_id: str,
    key: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        existing = get_session(session_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve access session",
        ) from exc

    if existing is None:
        raise HTTPException(status_code=404, detail="Session not found")

    _ensure_session_access(existing, user)

    try:
        content = read_session_object(session_id, key)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        record_audit_event(
            action="OBJECT_READ_DENIED",
            actor_id=user.user_id,
            actor_role=user.role,
            resource_id=session_id,
            outcome="DENIED",
            details={"key": key},
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to read S3 object",
        ) from exc

    record_audit_event(
        action="OBJECT_READ_ALLOWED",
        actor_id=user.user_id,
        actor_role=user.role,
        resource_id=session_id,
        outcome="SUCCESS",
        details={"key": key},
    )

    return {
        "session_id": session_id,
        "key": key,
        "content": content,
    }


@app.post("/sessions/{session_id}/credentials")
def issue_credentials(
    session_id: str,
    response: Response,
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        existing = get_session(session_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve access session",
        ) from exc

    if existing is None:
        raise HTTPException(status_code=404, detail="Session not found")

    _ensure_session_access(existing, user)

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

    response.headers["Cache-Control"] = "no-store"
    record_audit_event(
        action="SESSION_CREDENTIALS_ISSUED",
        actor_id=user.user_id,
        actor_role=user.role,
        resource_id=session_id,
        outcome="SUCCESS",
    )

    return {
        "access_key_id": credentials["access_key_id"],
        "secret_access_key": credentials["secret_access_key"],
        "session_token": credentials["session_token"],
        "expires_at": credentials["expires_at"].isoformat(),
    }
