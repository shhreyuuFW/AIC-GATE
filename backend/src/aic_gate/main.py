import csv
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from aic_gate.audit import list_audit_events, record_audit_event
from aic_gate.auth import (
    AuthenticatedUser,
    account_to_authenticated_user,
    authenticate_account,
    begin_mfa_setup,
    confirm_mfa_enable,
    create_access_token,
    create_mfa_challenge_token,
    decode_mfa_challenge_token,
    disable_user_mfa,
    get_current_user,
    hash_password,
    require_admin,
    verify_user_otp,
)
from aic_gate.catalog import get_catalog_resource, list_client_catalog
from aic_gate.config import get_settings
from aic_gate.identity_store import (
    DEFAULT_LAB_ORG_ID,
    Organization,
    UserAccount,
    create_member_signup,
    create_organization,
    find_organization_by_invite_code,
    get_organization,
    get_user,
    list_org_users,
    review_user_account,
    rotate_org_invite_code,
)
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
from aic_gate.session import AccessSession, get_session_status
from aic_gate.sts_client import preview_session_policy
from aic_gate.validation import AccessRequest, validate_request

settings = get_settings()

app = FastAPI(
    title="AIC-Gate",
    description="Automated Identity Controller and Just-in-Time Gateway",
    version="0.3.0",
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


class OrgRegisterBody(BaseModel):
    org_name: str
    allowed_domain: str = ""
    admin_username: str
    admin_email: str
    admin_display_name: str
    admin_department: str = "Security Administration"
    password: str


class MemberSignupBody(BaseModel):
    invite_code: str
    username: str
    email: str
    display_name: str
    department: str = "Engineering"
    password: str


class MfaVerifyBody(BaseModel):
    mfa_challenge_token: str
    otp_code: str


class MfaCodeBody(BaseModel):
    otp_code: str


class MfaDisableBody(BaseModel):
    password: str


class ReviewMemberBody(BaseModel):
    decision: Literal["ACTIVE", "REJECTED"]


class AccessRequestBody(BaseModel):
    resource_id: str | None = None
    service: str = "s3"
    bucket: str = ""
    prefix: str = ""
    actions: list[str]
    duration_minutes: int
    reason: str


class PolicyPreviewBody(BaseModel):
    bucket: str
    prefix: str
    actions: list[str]
    service: str = "s3"


class ReviewBody(BaseModel):
    decision: str


def _user_to_dict(user: AuthenticatedUser) -> dict:
    return {
        "user_id": user.user_id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "department": user.department,
        "org_id": user.org_id,
        "mfa_enabled": user.mfa_enabled,
    }


def _member_to_dict(account: UserAccount) -> dict:
    """Serialize member metadata without password hashes or MFA secrets."""
    return {
        "user_id": account.user_id,
        "org_id": account.org_id,
        "username": account.username,
        "email": account.email,
        "display_name": account.display_name,
        "department": account.department,
        "role": account.role,
        "status": account.status,
        "mfa_enabled": account.mfa_enabled,
        "created_at": account.created_at,
    }


def _org_to_dict(org: Organization) -> dict:
    return {
        "org_id": org.org_id,
        "org_name": org.org_name,
        "allowed_domain": org.allowed_domain,
        "invite_code": org.invite_code,
        "created_at": org.created_at,
    }


def _request_to_dict(record) -> dict:
    """Serialize a request dataclass or DynamoDB item."""
    if isinstance(record, dict):
        data = dict(record)
        data.setdefault("org_id", DEFAULT_LAB_ORG_ID)
        data.setdefault("service", "s3")
        data.setdefault("risk_level", "LOW")
        return data

    return {
        "request_id": record.request_id,
        "requester_id": record.requester_id,
        "org_id": record.org_id,
        "service": record.service,
        "resource_id": record.resource_id,
        "bucket": record.bucket,
        "prefix": record.prefix,
        "actions": record.actions,
        "duration_minutes": record.duration_minutes,
        "reason": record.reason,
        "risk_level": record.risk_level,
        "status": record.status,
        "created_at": record.created_at.isoformat(),
        "reviewed_at": (
            record.reviewed_at.isoformat() if record.reviewed_at else None
        ),
        "reviewed_by": record.reviewed_by,
        "session_id": getattr(record, "session_id", None),
    }


def _session_to_dict(session: AccessSession) -> dict:
    return {
        "session_id": session.session_id,
        "request_id": session.request_id,
        "requester_id": session.requester_id,
        "org_id": session.org_id,
        "service": session.service,
        "resource_id": session.resource_id,
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
    session_org = session.org_id or DEFAULT_LAB_ORG_ID
    if session_org != user.org_id:
        raise HTTPException(status_code=403, detail="Forbidden")
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


# ---------------------------------------------------------------------------
# Auth, Organizations & Optional TOTP MFA
# ---------------------------------------------------------------------------


@app.post("/auth/register-org", status_code=201)
def register_organization(body: OrgRegisterBody):
    try:
        pw_hash = hash_password(body.password)
        org, admin = create_organization(
            org_name=body.org_name,
            allowed_domain=body.allowed_domain,
            admin_username=body.admin_username,
            admin_email=body.admin_email,
            admin_display_name=body.admin_display_name,
            admin_department=body.admin_department,
            admin_password_hash=pw_hash,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    auth_user = account_to_authenticated_user(admin)
    token, expires_in = create_access_token(auth_user)
    record_audit_event(
        action="ORG_REGISTERED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=org.org_id,
        outcome="SUCCESS",
        details={"org_name": org.org_name, "allowed_domain": org.allowed_domain},
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "user": _user_to_dict(auth_user),
        "organization": _org_to_dict(org),
    }


@app.post("/auth/signup", status_code=201)
def member_signup(body: MemberSignupBody):
    org = find_organization_by_invite_code(body.invite_code)
    if org is None:
        raise HTTPException(
            status_code=404,
            detail="Invalid organization invite code.",
        )

    try:
        pw_hash = hash_password(body.password)
        account = create_member_signup(
            org_id=org.org_id,
            username=body.username,
            email=body.email,
            display_name=body.display_name,
            department=body.department,
            password_hash=pw_hash,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_audit_event(
        action="USER_SIGNUP_REQUESTED",
        actor_id=account.user_id,
        actor_role="requester",
        resource_id=org.org_id,
        outcome="SUCCESS",
        details={"username": account.username, "department": account.department},
    )
    return {
        "message": "Signup submitted. Awaiting organization administrator approval.",
        "user": _member_to_dict(account),
    }


@app.post("/auth/login")
def login(body: LoginBody):
    try:
        account = authenticate_account(body.username, body.password)
    except PermissionError as exc:
        record_audit_event(
            action="AUTH_LOGIN_FAILED",
            actor_id=body.username.strip() or "anonymous",
            actor_role="unknown",
            outcome="DENIED",
            details={"reason": str(exc)},
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    if account is None:
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

    if account.mfa_enabled:
        challenge = create_mfa_challenge_token(account)
        record_audit_event(
            action="AUTH_MFA_CHALLENGED",
            actor_id=account.user_id,
            actor_role=account.role,
            outcome="SUCCESS",
        )
        return {
            "mfa_required": True,
            "mfa_challenge_token": challenge,
        }

    user = account_to_authenticated_user(account)
    token, expires_in = create_access_token(user)
    record_audit_event(
        action="AUTH_LOGIN_SUCCESS",
        actor_id=user.user_id,
        actor_role=user.role,
        outcome="SUCCESS",
    )
    return {
        "mfa_required": False,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "user": _user_to_dict(user),
    }


@app.post("/auth/mfa/verify")
def verify_mfa_login(body: MfaVerifyBody):
    try:
        username = decode_mfa_challenge_token(body.mfa_challenge_token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    account = get_user(username)
    if account is None or account.status != "ACTIVE":
        raise HTTPException(status_code=401, detail="Account is not active.")

    if not verify_user_otp(account, body.otp_code):
        record_audit_event(
            action="AUTH_MFA_FAILED",
            actor_id=account.user_id,
            actor_role=account.role,
            outcome="DENIED",
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid 6-digit authenticator code.",
        )

    user = account_to_authenticated_user(account)
    token, expires_in = create_access_token(user)
    record_audit_event(
        action="AUTH_LOGIN_SUCCESS",
        actor_id=user.user_id,
        actor_role=user.role,
        outcome="SUCCESS",
        details={"mfa": True},
    )
    return {
        "mfa_required": False,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "user": _user_to_dict(user),
    }


@app.post("/auth/mfa/setup")
def start_mfa_setup(user: AuthenticatedUser = Depends(get_current_user)):
    try:
        secret, uri = begin_mfa_setup(user.username)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"secret": secret, "otpauth_uri": uri}


@app.post("/auth/mfa/enable")
def enable_mfa(
    body: MfaCodeBody,
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        account = confirm_mfa_enable(user.username, body.otp_code)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    auth_user = account_to_authenticated_user(account)
    token, expires_in = create_access_token(auth_user)
    record_audit_event(
        action="USER_MFA_ENABLED",
        actor_id=auth_user.user_id,
        actor_role=auth_user.role,
        outcome="SUCCESS",
    )
    return {
        "mfa_enabled": True,
        "access_token": token,
        "expires_in": expires_in,
        "user": _user_to_dict(auth_user),
    }


@app.post("/auth/mfa/disable")
def disable_mfa(
    body: MfaDisableBody,
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        account = disable_user_mfa(user.username, body.password)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    auth_user = account_to_authenticated_user(account)
    token, expires_in = create_access_token(auth_user)
    record_audit_event(
        action="USER_MFA_DISABLED",
        actor_id=auth_user.user_id,
        actor_role=auth_user.role,
        outcome="SUCCESS",
    )
    return {
        "mfa_enabled": False,
        "access_token": token,
        "expires_in": expires_in,
        "user": _user_to_dict(auth_user),
    }


@app.get("/auth/me")
def get_me(user: AuthenticatedUser = Depends(get_current_user)):
    account = get_user(user.username)
    if account is not None:
        return _user_to_dict(account_to_authenticated_user(account))
    return _user_to_dict(user)


# ---------------------------------------------------------------------------
# Resource Catalog & Admin-Only Policy Compiler Preview
# ---------------------------------------------------------------------------


@app.get("/catalog")
def get_catalog(_user: AuthenticatedUser = Depends(get_current_user)):
    return {"resources": list_client_catalog()}


@app.post("/admin/policy/preview")
def admin_preview_policy(
    body: PolicyPreviewBody,
    _admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        policy = preview_session_policy(
            bucket=body.bucket,
            prefix=body.prefix,
            actions=body.actions,
            service=body.service,
        )
        return {"policy": policy}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Access Requests
# ---------------------------------------------------------------------------


@app.post("/requests", status_code=201)
def submit_request(
    body: AccessRequestBody,
    user: AuthenticatedUser = Depends(get_current_user),
):
    if body.resource_id:
        res = get_catalog_resource(body.resource_id)
        if res is None:
            raise HTTPException(
                status_code=400,
                detail="Unknown catalog resource.",
            )
        service = res.service
        bucket = res.aws_target
        prefix = body.prefix.strip() or res.default_prefix
        resource_id = res.resource_id
    else:
        service = body.service
        bucket = body.bucket
        prefix = body.prefix
        resource_id = None

    request = AccessRequest(
        bucket=bucket,
        prefix=prefix,
        actions=body.actions,
        duration_minutes=body.duration_minutes,
        reason=body.reason,
        service=service,
        resource_id=resource_id,
    )

    try:
        record = submit_access_request_record(
            request,
            requester_id=user.user_id,
            org_id=user.org_id,
        )
        data = _request_to_dict(record)
        record_audit_event(
            action="REQUEST_CREATED",
            actor_id=user.user_id,
            actor_role=user.role,
            resource_id=data.get("request_id"),
            outcome="SUCCESS",
            details={
                "service": service,
                "bucket": bucket,
                "prefix": prefix,
                "actions": body.actions,
                "duration_minutes": body.duration_minutes,
                "risk_level": data.get("risk_level"),
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
            org_id=user.org_id,
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
    if data.get("org_id", DEFAULT_LAB_ORG_ID) != user.org_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user.role != "admin" and data.get("requester_id") != user.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    return data


# ---------------------------------------------------------------------------
# Admin Governance: Org, Members, Queue, Audit Export & Security Proof
# ---------------------------------------------------------------------------


@app.get("/admin/org")
def admin_get_org(admin: AuthenticatedUser = Depends(require_admin)):
    org = get_organization(admin.org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return _org_to_dict(org)


@app.post("/admin/org/rotate-invite")
def admin_rotate_invite(admin: AuthenticatedUser = Depends(require_admin)):
    try:
        org = rotate_org_invite_code(admin.org_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    record_audit_event(
        action="ORG_INVITE_ROTATED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=org.org_id,
        outcome="SUCCESS",
    )
    return _org_to_dict(org)


@app.get("/admin/users")
def admin_list_users(admin: AuthenticatedUser = Depends(require_admin)):
    members = list_org_users(admin.org_id)
    return {"users": [_member_to_dict(m) for m in members]}


@app.post("/admin/users/{username}/review")
def admin_review_user(
    username: str,
    body: ReviewMemberBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        updated = review_user_account(admin.org_id, username, body.decision)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_audit_event(
        action="USER_SIGNUP_REVIEWED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=updated.user_id,
        outcome="SUCCESS",
        details={"username": updated.username, "decision": body.decision},
    )
    return _member_to_dict(updated)


@app.get("/admin/requests")
def admin_list_requests(
    status: str | None = None,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        records = list_access_request_records(
            status=status,
            org_id=admin.org_id,
        )
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
        existing = get_access_request_record(request_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to review access request",
        ) from exc

    if existing is None:
        raise HTTPException(status_code=404, detail="Access request not found.")
    if (existing.get("org_id") or DEFAULT_LAB_ORG_ID) != admin.org_id:
        raise HTTPException(status_code=403, detail="Forbidden")

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
        existing = get_access_request_record(request_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to create session from approved request",
        ) from exc

    if existing is None:
        raise HTTPException(status_code=404, detail="Access request not found.")
    if (existing.get("org_id") or DEFAULT_LAB_ORG_ID) != admin.org_id:
        raise HTTPException(status_code=403, detail="Forbidden")

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
            "service": session.service,
            "bucket": session.bucket,
            "prefix": session.prefix,
        },
    )

    return {
        **_session_to_dict(session),
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


@app.get("/admin/audit/export")
def admin_export_audit(
    format: Literal["json", "csv"] = Query(default="json"),
    limit: int = Query(default=200, ge=1, le=500),
    admin: AuthenticatedUser = Depends(require_admin),
):
    events = list_audit_events(limit=limit)
    record_audit_event(
        action="AUDIT_EXPORTED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        outcome="SUCCESS",
        details={"format": format, "count": len(events)},
    )

    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "event_id",
                "timestamp",
                "action",
                "outcome",
                "actor_id",
                "actor_role",
                "resource_id",
                "details",
            ]
        )
        for ev in events:
            writer.writerow(
                [
                    ev["event_id"],
                    ev["timestamp"],
                    ev["action"],
                    ev["outcome"],
                    ev["actor_id"],
                    ev["actor_role"],
                    ev["resource_id"] or "",
                    json.dumps(ev["details"], separators=(",", ":")),
                ]
            )
        return PlainTextResponse(
            content=buffer.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="aic-gate-audit.csv"'
            },
        )

    return Response(
        content=json.dumps({"events": events}, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="aic-gate-audit.json"'
        },
    )


@app.post("/admin/security-proof")
def run_security_boundary_proof(
    admin: AuthenticatedUser = Depends(require_admin),
):
    """Run live in-process verification of core security boundary controls."""
    checks: list[dict] = []

    # 1. Valid scoped request passes validation & compiles policy
    try:
        policy = preview_session_policy(
            bucket="cloudsec.proj.aicgate",
            prefix="logs/",
            actions=["s3:GetObject"],
            service="s3",
        )
        checks.append(
            {
                "id": "PROOF-01",
                "control": "Scoped S3 Policy Compilation",
                "expected": "ALLOW",
                "passed": len(policy["Statement"]) == 1,
                "detail": "Compiled least-privilege s3:GetObject statement for logs/*",
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "PROOF-01",
                "control": "Scoped S3 Policy Compilation",
                "expected": "ALLOW",
                "passed": False,
                "detail": str(exc),
            }
        )

    # 2. Path traversal blocked
    traversal_blocked = False
    try:
        validate_request(
            AccessRequest(
                bucket="cloudsec.proj.aicgate",
                prefix="logs/../restricted/",
                actions=["s3:GetObject"],
                duration_minutes=15,
                reason="security proof",
            )
        )
    except ValueError:
        traversal_blocked = True
    checks.append(
        {
            "id": "PROOF-02",
            "control": "Path Traversal Rejection (logs/../restricted/)",
            "expected": "DENY (400)",
            "passed": traversal_blocked,
            "detail": "Blocked '..' traversal segment before STS policy generation.",
        }
    )

    # 3. Wildcard prefix injection blocked
    wildcard_blocked = False
    try:
        validate_request(
            AccessRequest(
                bucket="cloudsec.proj.aicgate",
                prefix="logs*",
                actions=["s3:GetObject"],
                duration_minutes=15,
                reason="security proof",
            )
        )
    except ValueError:
        wildcard_blocked = True
    checks.append(
        {
            "id": "PROOF-03",
            "control": "Wildcard Prefix Injection Rejection (logs*)",
            "expected": "DENY (400)",
            "passed": wildcard_blocked,
            "detail": "Blocked '*' wildcard before S3 StringLike evaluation.",
        }
    )

    # 4. Non-admin privilege escalation blocked by RBAC
    rbac_blocked = False
    fake_requester = AuthenticatedUser(
        user_id="usr-proof-req",
        username="proof-req",
        display_name="Proof Requester",
        role="requester",
        department="Engineering",
        org_id=admin.org_id,
    )
    try:
        require_admin(fake_requester)
    except HTTPException as exc:
        rbac_blocked = exc.status_code == 403
    checks.append(
        {
            "id": "PROOF-04",
            "control": "Server-Side Admin RBAC Enforcement",
            "expected": "DENY (403)",
            "passed": rbac_blocked,
            "detail": "Requester role denied access to Admin dependency.",
        }
    )

    # 5. Expired session boundary enforced
    now = datetime.now(timezone.utc)
    expired_session = AccessSession(
        session_id="proof-expired-01",
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        created_at=now - timedelta(minutes=30),
        expires_at=now - timedelta(seconds=1),
        status="ACTIVE",
        org_id=admin.org_id,
    )
    expired_enforced = get_session_status(expired_session, now) == "EXPIRED"
    checks.append(
        {
            "id": "PROOF-05",
            "control": "Expired Session Auto-Termination",
            "expected": "EXPIRED",
            "passed": expired_enforced,
            "detail": "Session past expires_at evaluated to EXPIRED regardless of stored ACTIVE flag.",
        }
    )

    passed_count = sum(1 for c in checks if c["passed"])
    record_audit_event(
        action="SECURITY_PROOF_EXECUTED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        outcome="SUCCESS" if passed_count == len(checks) else "FAILED",
        details={"passed": passed_count, "total": len(checks)},
    )
    return {
        "passed": passed_count,
        "total": len(checks),
        "executed_at": now.isoformat(),
        "checks": checks,
    }


# ---------------------------------------------------------------------------
# Sessions & Proxied S3 Scope Tester
# ---------------------------------------------------------------------------


@app.get("/sessions")
def list_sessions_endpoint(
    user: AuthenticatedUser = Depends(get_current_user),
):
    requester_filter = None if user.role == "admin" else user.user_id
    try:
        sessions = list_access_sessions(
            requester_id=requester_filter,
            org_id=user.org_id,
        )
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
    if existing.service != "s3":
        raise HTTPException(
            status_code=400,
            detail="Proxied object reader only applies to S3 sessions.",
        )

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
