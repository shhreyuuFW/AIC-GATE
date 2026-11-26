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
    admin_reset_user_mfa,
    authenticate_account,
    begin_mfa_setup,
    confirm_mfa_enable,
    create_access_token,
    create_mfa_challenge_token,
    decode_mfa_challenge_token,
    disable_user_mfa,
    ensure_demo_users_seeded,
    get_current_user,
    hash_password,
    require_admin,
    require_org_owner,
    require_platform_admin,
    verify_user_otp,
)
from aic_gate.catalog import get_catalog_resource, list_client_catalog
from aic_gate.config import get_settings
from aic_gate.identity_store import (
    DEFAULT_LAB_ORG_ID,
    DEFAULT_PLATFORM_ORG_ID,
    NotificationItem,
    Organization,
    OrgRole,
    SupportTicket,
    TicketCategory,
    TicketStatus,
    UserAccount,
    assign_role_to_users,
    create_member_signup,
    create_notification,
    create_org_role,
    create_organization,
    create_support_ticket,
    delete_org_role,
    find_organization_by_invite_code,
    get_organization,
    get_support_ticket,
    get_user,
    get_user_by_id,
    list_all_organizations,
    list_all_tickets,
    list_org_roles,
    list_org_tickets,
    list_org_users,
    list_user_notifications,
    manage_org_member,
    mark_notifications_read,
    notify_org_admins,
    notify_platform_admins,
    record_user_login,
    resolve_user_role_meta,
    review_user_account,
    rotate_org_invite_code,
    update_org_role,
    update_organization,
    update_support_ticket,
    update_user_profile,
)
from aic_gate.request_service import (
    create_approved_session,
    get_access_request_record,
    list_access_request_records,
    review_access_request,
    submit_access_request_record,
)
from aic_gate.scope_tester import (
    execute_session_scope_test,
    get_scope_tester_presets,
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
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
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


class ProfileUpdateBody(BaseModel):
    display_name: str | None = None
    bio: str | None = None
    avatar: str | None = None


class OrgUpdateBody(BaseModel):
    org_name: str | None = None
    allowed_domain: str | None = None


class ManageMemberBody(BaseModel):
    department: str | None = None
    status: Literal["ACTIVE", "SUSPENDED"] | None = None
    custom_role_id: str | None = None
    clear_custom_role: bool = False
    admin_action: Literal["PROMOTE_DELEGATED", "DEMOTE_REQUESTER"] | None = None


class OrgRoleBody(BaseModel):
    name: str
    description: str = ""
    color: str = "cyan"


class OrgRoleUpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None


class RoleAssignBody(BaseModel):
    usernames: list[str]


class NotificationReadBody(BaseModel):
    notification_id: str | None = None
    mark_all: bool = False


class SupportTicketCreateBody(BaseModel):
    category: TicketCategory
    subject: str
    description: str
    requested_value: str = ""


class MasterOrgUpdateBody(BaseModel):
    org_name: str | None = None
    allowed_domain: str | None = None
    status: Literal["ACTIVE", "SUSPENDED"] | None = None


class MasterSetAdminBody(BaseModel):
    username: str
    tier: Literal["delegated", "owner", "none"]


class MasterTicketUpdateBody(BaseModel):
    status: TicketStatus
    resolution_note: str = ""
    apply_org_rename: bool = False


class ScopeTestBody(BaseModel):
    service: Literal["s3", "dynamodb", "cloudwatch_logs", "ssm"]
    query: str
    use_lab_sample: bool = False


def _user_to_dict(user: AuthenticatedUser) -> dict:
    account = get_user(user.username)
    org = get_organization(user.org_id)
    org_name = (
        "AIC-GATE Platform"
        if user.role == "platform_admin" or user.org_id == DEFAULT_PLATFORM_ORG_ID
        else (org.org_name if org else user.org_id)
    )
    if account is not None:
        role_meta = resolve_user_role_meta(account)
        tier = account.admin_tier
        if account.role == "admin" and tier == "none":
            tier = "owner"
        elif account.role == "platform_admin" and tier == "none":
            tier = "master"
        return {
            "user_id": account.user_id,
            "username": account.username,
            "display_name": account.display_name,
            "role": account.role,
            "admin_tier": tier,
            "department": account.department,
            "org_id": account.org_id,
            "org_name": org_name,
            "mfa_enabled": account.mfa_enabled,
            "bio": account.bio,
            "avatar": account.avatar,
            "custom_role_id": role_meta["custom_role_id"],
            "custom_role_name": role_meta["custom_role_name"],
            "custom_role_color": role_meta["custom_role_color"],
            "effective_role": role_meta["effective_role"],
            "last_login_at": account.last_login_at,
            "previous_login_at": account.previous_login_at,
        }

    default_role = (
        "Master Admin"
        if user.role == "platform_admin"
        else ("Org Owner" if user.role == "admin" else "Requester")
    )
    return {
        "user_id": user.user_id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "admin_tier": user.admin_tier,
        "department": user.department,
        "org_id": user.org_id,
        "org_name": org_name,
        "mfa_enabled": user.mfa_enabled,
        "bio": "",
        "avatar": "",
        "custom_role_id": None,
        "custom_role_name": None,
        "custom_role_color": "amber" if user.role == "admin" else "cyan",
        "effective_role": default_role,
        "last_login_at": None,
        "previous_login_at": None,
    }


def _member_to_dict(account: UserAccount) -> dict:
    """Serialize member metadata without password hashes or MFA secrets."""
    role_meta = resolve_user_role_meta(account)
    return {
        "user_id": account.user_id,
        "org_id": account.org_id,
        "username": account.username,
        "email": account.email,
        "display_name": account.display_name,
        "department": account.department,
        "role": account.role,
        "admin_tier": account.admin_tier,
        "status": account.status,
        "mfa_enabled": account.mfa_enabled,
        "bio": account.bio,
        "avatar": account.avatar,
        "custom_role_id": role_meta["custom_role_id"],
        "custom_role_name": role_meta["custom_role_name"],
        "custom_role_color": role_meta["custom_role_color"],
        "effective_role": role_meta["effective_role"],
        "last_login_at": account.last_login_at,
        "created_at": account.created_at,
    }


def _org_to_dict(org: Organization) -> dict:
    return {
        "org_id": org.org_id,
        "org_name": org.org_name,
        "allowed_domain": org.allowed_domain,
        "invite_code": org.invite_code,
        "owner_user_id": org.owner_user_id,
        "status": org.status,
        "created_at": org.created_at,
    }


def _role_to_dict(role: OrgRole) -> dict:
    return {
        "role_id": role.role_id,
        "org_id": role.org_id,
        "name": role.name,
        "description": role.description,
        "color": role.color,
        "created_at": role.created_at,
        "created_by": role.created_by,
    }


def _notif_to_dict(notif: NotificationItem) -> dict:
    return {
        "notification_id": notif.notification_id,
        "user_id": notif.user_id,
        "org_id": notif.org_id,
        "kind": notif.kind,
        "title": notif.title,
        "message": notif.message,
        "created_at": notif.created_at,
        "read": notif.read,
        "link": notif.link,
    }


def _ticket_to_dict(ticket: SupportTicket) -> dict:
    return {
        "ticket_id": ticket.ticket_id,
        "org_id": ticket.org_id,
        "org_name": ticket.org_name,
        "created_by_user_id": ticket.created_by_user_id,
        "created_by_username": ticket.created_by_username,
        "category": ticket.category,
        "subject": ticket.subject,
        "description": ticket.description,
        "requested_value": ticket.requested_value,
        "status": ticket.status,
        "resolution_note": ticket.resolution_note,
        "resolved_by": ticket.resolved_by,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
    }


def _request_to_dict(record) -> dict:
    """Serialize a request dataclass or DynamoDB item."""
    if isinstance(record, dict):
        data = dict(record)
        data.setdefault("org_id", DEFAULT_LAB_ORG_ID)
        data.setdefault("service", "s3")
        data.setdefault("risk_level", "LOW")
        req_user = get_user_by_id(str(data.get("requester_id") or ""))
        if req_user is not None:
            if not data.get("requester_username"):
                data["requester_username"] = req_user.username
            if not data.get("requester_display_name"):
                data["requester_display_name"] = req_user.display_name
        return data

    req_user = get_user_by_id(record.requester_id)
    req_uname = getattr(record, "requester_username", "") or (
        req_user.username if req_user else record.requester_id
    )
    req_dname = getattr(record, "requester_display_name", "") or (
        req_user.display_name if req_user else record.requester_id
    )
    return {
        "request_id": record.request_id,
        "requester_id": record.requester_id,
        "requester_username": req_uname,
        "requester_display_name": req_dname,
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
    req_user = get_user_by_id(session.requester_id or "")
    role_meta = resolve_user_role_meta(req_user) if req_user else None
    return {
        "session_id": session.session_id,
        "request_id": session.request_id,
        "requester_id": session.requester_id,
        "requester_username": req_user.username if req_user else (session.requester_id or "legacy-operator"),
        "requester_display_name": req_user.display_name if req_user else (session.requester_id or "Legacy Operator"),
        "requester_role_label": role_meta["effective_role"] if role_meta else "Requester",
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
    return FileResponse(
        index_path,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
        },
    )


@app.get("/aic-gate-logo.svg", include_in_schema=False)
def serve_app_logo():
    logo_path = FRONTEND_DIST_DIR / "aic-gate-logo.svg"
    if not logo_path.is_file():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(logo_path, media_type="image/svg+xml")


@app.get("/", include_in_schema=False)
@app.get("/login", include_in_schema=False)
@app.get("/client", include_in_schema=False)
@app.get("/client/{path:path}", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
@app.get("/admin/team", include_in_schema=False)
@app.get("/admin/roles", include_in_schema=False)
@app.get("/admin/sessions", include_in_schema=False)
@app.get("/admin/graph", include_in_schema=False)
@app.get("/admin/audit-log", include_in_schema=False)
@app.get("/admin/guide", include_in_schema=False)
@app.get("/admin/profile", include_in_schema=False)
@app.get("/master", include_in_schema=False)
@app.get("/master/{path:path}", include_in_schema=False)
def frontend(path: str = ""):
    del path
    return _serve_spa_index()


# ---------------------------------------------------------------------------
# Auth, Organizations & Optional TOTP MFA
# ---------------------------------------------------------------------------


@app.get("/auth/invite/{invite_code}")
def lookup_invite_code(invite_code: str):
    """Public safe invite lookup for Join Org domain autocomplete."""
    ensure_demo_users_seeded()
    org = find_organization_by_invite_code(invite_code)
    if org is None or org.status == "SUSPENDED":
        raise HTTPException(
            status_code=404,
            detail="Invalid or inactive organization invite code.",
        )
    return {
        "org_name": org.org_name,
        "allowed_domain": org.allowed_domain,
    }


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

    record_user_login(admin.username)
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
    ensure_demo_users_seeded()
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

    notify_org_admins(
        org_id=org.org_id,
        kind="MEMBER_SIGNUP",
        title="New Member Signup Pending",
        message=f"{account.display_name} (@{account.username}) requested to join {org.org_name}.",
        link="/admin/team",
    )
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

    record_user_login(account.username)
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

    record_user_login(account.username)
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


@app.patch("/auth/profile")
def update_my_profile(
    body: ProfileUpdateBody,
    user: AuthenticatedUser = Depends(get_current_user),
):
    try:
        updated = update_user_profile(
            user.username,
            display_name=body.display_name,
            bio=body.bio,
            avatar=body.avatar,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    auth_user = account_to_authenticated_user(updated)
    token, expires_in = create_access_token(auth_user)
    record_audit_event(
        action="USER_PROFILE_UPDATED",
        actor_id=auth_user.user_id,
        actor_role=auth_user.role,
        outcome="SUCCESS",
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": expires_in,
        "user": _user_to_dict(auth_user),
    }


def _compute_away_summary(
    user: AuthenticatedUser,
    items: list[NotificationItem],
) -> dict | None:
    unread = [n for n in items if not n.read]
    if not unread:
        return None

    account = get_user(user.username)
    last_login = account.last_login_at if account else None
    prev_login = account.previous_login_at if account else None

    arrived_while_away = False
    if last_login:
        if any(n.created_at <= last_login for n in unread):
            arrived_while_away = True
        elif prev_login:
            try:
                gap = (
                    datetime.fromisoformat(last_login)
                    - datetime.fromisoformat(prev_login)
                ).total_seconds()
                if gap >= 600:
                    arrived_while_away = True
            except ValueError:
                pass

    counts: dict[str, int] = {}
    for n in unread:
        counts[n.kind] = counts.get(n.kind, 0) + 1

    parts = []
    if counts.get("MEMBER_SIGNUP"):
        parts.append(f"{counts['MEMBER_SIGNUP']} signup(s)")
    if counts.get("ACCESS_REQUEST"):
        parts.append(f"{counts['ACCESS_REQUEST']} access request(s)")
    if counts.get("REQUEST_DECISION"):
        parts.append(f"{counts['REQUEST_DECISION']} request update(s)")
    if counts.get("SESSION_READY"):
        parts.append(f"{counts['SESSION_READY']} provisioned session(s)")
    if counts.get("SUPPORT_TICKET"):
        parts.append(f"{counts['SUPPORT_TICKET']} ticket update(s)")
    if not parts:
        parts.append(f"{len(unread)} workspace update(s)")
    summary_text = ", ".join(parts)

    if arrived_while_away:
        return {
            "variant": "away",
            "headline": "While you were away...",
            "detail": f"You received {summary_text}.",
            "count": len(unread),
        }

    return {
        "variant": "live",
        "headline": "New activity in your workspace",
        "detail": f"Active updates: {summary_text}.",
        "count": len(unread),
    }


@app.get("/notifications")
def get_my_notifications(user: AuthenticatedUser = Depends(get_current_user)):
    items = list_user_notifications(user.user_id, limit=40)
    unread_count = sum(1 for n in items if not n.read)
    return {
        "notifications": [_notif_to_dict(n) for n in items],
        "unread_count": unread_count,
        "away_summary": _compute_away_summary(user, items),
    }


@app.post("/notifications/read")
def read_my_notifications(
    body: NotificationReadBody,
    user: AuthenticatedUser = Depends(get_current_user),
):
    target_id = None if body.mark_all else body.notification_id
    if not body.mark_all and not target_id:
        raise HTTPException(
            status_code=400,
            detail="Provide notification_id or set mark_all=true.",
        )
    marked = mark_notifications_read(user.user_id, target_id)
    return {"marked": marked}


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
    if user.role == "platform_admin":
        raise HTTPException(
            status_code=403,
            detail="Platform Master Admin cannot submit tenant access requests.",
        )
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
            requester_username=user.username,
            requester_display_name=user.display_name,
        )
        data = _request_to_dict(record)
        notify_org_admins(
            org_id=user.org_id,
            kind="ACCESS_REQUEST",
            title="New JIT Access Request",
            message=(
                f"{user.display_name} (@{user.username}) requested "
                f"{service.upper()} access ({data.get('risk_level', 'LOW')} risk)."
            ),
            link="/admin",
        )
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
    if user.role == "platform_admin":
        raise HTTPException(
            status_code=403,
            detail="Platform Master Admin cannot access tenant access requests.",
        )
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


@app.patch("/admin/org")
def admin_update_org(
    body: OrgUpdateBody,
    owner: AuthenticatedUser = Depends(require_org_owner),
):
    try:
        org = update_organization(
            owner.org_id,
            org_name=body.org_name,
            allowed_domain=body.allowed_domain,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_audit_event(
        action="ORG_UPDATED",
        actor_id=owner.user_id,
        actor_role=owner.role,
        resource_id=org.org_id,
        outcome="SUCCESS",
        details={"org_name": org.org_name, "allowed_domain": org.allowed_domain},
    )
    return _org_to_dict(org)


@app.post("/admin/org/rotate-invite")
def admin_rotate_invite(owner: AuthenticatedUser = Depends(require_org_owner)):
    try:
        org = rotate_org_invite_code(owner.org_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    record_audit_event(
        action="ORG_INVITE_ROTATED",
        actor_id=owner.user_id,
        actor_role=owner.role,
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


@app.patch("/admin/users/{username}")
def admin_manage_member(
    username: str,
    body: ManageMemberBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    effective_tier = "owner" if admin.admin_tier == "none" else admin.admin_tier
    kwargs: dict = {
        "actor_user_id": admin.user_id,
        "actor_is_owner": effective_tier == "owner",
        "department": body.department,
        "status": body.status,
        "admin_action": body.admin_action,
    }
    if body.clear_custom_role:
        kwargs["custom_role_id"] = None
    elif body.custom_role_id is not None:
        kwargs["custom_role_id"] = body.custom_role_id

    try:
        updated = manage_org_member(admin.org_id, username, **kwargs)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.custom_role_id is not None or body.clear_custom_role or body.admin_action:
        meta = resolve_user_role_meta(updated)
        create_notification(
            user_id=updated.user_id,
            org_id=updated.org_id,
            kind="ROLE_UPDATED",
            title="Account Role Updated",
            message=f"An administrator updated your role to {meta['effective_role']}.",
            link="/client",
        )

    record_audit_event(
        action="USER_UPDATED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=updated.user_id,
        outcome="SUCCESS",
        details={
            "username": updated.username,
            "role": updated.role,
            "admin_tier": updated.admin_tier,
            "status": updated.status,
            "custom_role_id": updated.custom_role_id,
        },
    )
    return _member_to_dict(updated)


@app.get("/admin/org-roles")
def admin_list_org_roles(admin: AuthenticatedUser = Depends(require_admin)):
    roles = list_org_roles(admin.org_id)
    members = list_org_users(admin.org_id)
    counts: dict[str, int] = {}
    for m in members:
        if m.custom_role_id:
            counts[m.custom_role_id] = counts.get(m.custom_role_id, 0) + 1
    return {
        "roles": [
            {**_role_to_dict(r), "member_count": counts.get(r.role_id, 0)}
            for r in roles
        ]
    }


@app.post("/admin/org-roles", status_code=201)
def admin_create_org_role(
    body: OrgRoleBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        role = create_org_role(
            admin.org_id,
            name=body.name,
            description=body.description,
            color=body.color,
            created_by=admin.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_audit_event(
        action="ORG_ROLE_CREATED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=role.role_id,
        outcome="SUCCESS",
        details={"name": role.name, "color": role.color},
    )
    return _role_to_dict(role)


@app.patch("/admin/org-roles/{role_id}")
def admin_update_org_role(
    role_id: str,
    body: OrgRoleUpdateBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        role = update_org_role(
            admin.org_id,
            role_id,
            name=body.name,
            description=body.description,
            color=body.color,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_audit_event(
        action="ORG_ROLE_UPDATED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=role.role_id,
        outcome="SUCCESS",
        details={"name": role.name},
    )
    return _role_to_dict(role)


@app.delete("/admin/org-roles/{role_id}")
def admin_delete_org_role(
    role_id: str,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        delete_org_role(admin.org_id, role_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    record_audit_event(
        action="ORG_ROLE_DELETED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=role_id,
        outcome="SUCCESS",
    )
    return {"deleted": role_id}


@app.post("/admin/org-roles/{role_id}/assign")
def admin_assign_role(
    role_id: str,
    body: RoleAssignBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    try:
        updated = assign_role_to_users(admin.org_id, role_id, body.usernames)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    for m in updated:
        meta = resolve_user_role_meta(m)
        create_notification(
            user_id=m.user_id,
            org_id=m.org_id,
            kind="ROLE_UPDATED",
            title="Role Assigned",
            message=f"You were assigned the role {meta['effective_role']}.",
            link="/client",
        )

    record_audit_event(
        action="ORG_ROLE_ASSIGNED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=role_id,
        outcome="SUCCESS",
        details={"count": len(updated)},
    )
    return {"updated": [_member_to_dict(m) for m in updated]}


@app.post("/admin/org-roles/unassign")
def admin_unassign_role(
    body: RoleAssignBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    updated = assign_role_to_users(admin.org_id, None, body.usernames)
    record_audit_event(
        action="ORG_ROLE_UNASSIGNED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        outcome="SUCCESS",
        details={"count": len(updated)},
    )
    return {"updated": [_member_to_dict(m) for m in updated]}


@app.get("/admin/tickets")
def admin_list_org_tickets(admin: AuthenticatedUser = Depends(require_admin)):
    return {"tickets": [_ticket_to_dict(t) for t in list_org_tickets(admin.org_id)]}


@app.post("/admin/tickets", status_code=201)
def admin_create_support_ticket(
    body: SupportTicketCreateBody,
    admin: AuthenticatedUser = Depends(require_admin),
):
    org = get_organization(admin.org_id)
    org_name = org.org_name if org else admin.org_id
    try:
        ticket = create_support_ticket(
            org_id=admin.org_id,
            org_name=org_name,
            created_by_user_id=admin.user_id,
            created_by_username=admin.username,
            category=body.category,
            subject=body.subject,
            description=body.description,
            requested_value=body.requested_value,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    notify_platform_admins(
        kind="SUPPORT_TICKET",
        title=f"New Org Ticket [{ticket.category}]",
        message=f"{org_name} (@{admin.username}): {ticket.subject}",
        link="/master",
    )
    record_audit_event(
        action="SUPPORT_TICKET_CREATED",
        actor_id=admin.user_id,
        actor_role=admin.role,
        resource_id=ticket.ticket_id,
        outcome="SUCCESS",
        details={"category": ticket.category, "org_id": admin.org_id},
    )
    return _ticket_to_dict(ticket)


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
        req_dict = _request_to_dict(record)
        requester_id = str(req_dict.get("requester_id") or "")
        if requester_id:
            create_notification(
                user_id=requester_id,
                org_id=admin.org_id,
                kind="REQUEST_DECISION",
                title=f"Access Request {body.decision}",
                message=(
                    f"Your {(req_dict.get('service') or 's3').upper()} request "
                    f"({req_dict.get('prefix', '')}) was {body.decision.lower()} by @{admin.username}."
                ),
                link="/client",
            )
        record_audit_event(
            action="REQUEST_REVIEWED",
            actor_id=admin.user_id,
            actor_role=admin.role,
            resource_id=request_id,
            outcome="SUCCESS",
            details={"decision": body.decision},
        )
        return req_dict
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
    if session.requester_id:
        create_notification(
            user_id=session.requester_id,
            org_id=session.org_id,
            kind="SESSION_READY",
            title="JIT Session Provisioned",
            message=(
                f"Your {session.service.upper()} session ({session.prefix}) is live and ready for STS key minting."
            ),
            link="/client/sessions",
        )
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
    if user.role == "platform_admin":
        raise HTTPException(
            status_code=403,
            detail="Platform Master Admin cannot access tenant STS sessions.",
        )
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

    if (
        user.role == "admin"
        and session.requester_id
        and session.requester_id != user.user_id
    ):
        create_notification(
            user_id=session.requester_id,
            org_id=session.org_id,
            kind="SESSION_REVOKED",
            title="Session Revoked",
            message=f"Your {session.service.upper()} session ({session.prefix}) was revoked by @{user.username}.",
            link="/client/sessions",
        )

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


@app.get("/scope-tester/presets")
def scope_tester_presets(_user: AuthenticatedUser = Depends(get_current_user)):
    return {"presets": get_scope_tester_presets()}


@app.post("/sessions/{session_id}/test")
def run_scope_test(
    session_id: str,
    body: ScopeTestBody,
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
        result = execute_session_scope_test(
            existing,
            target_service=body.service,
            query=body.query,
            use_lab_sample=body.use_lab_sample,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        record_audit_event(
            action="SCOPE_TEST_DENIED",
            actor_id=user.user_id,
            actor_role=user.role,
            resource_id=session_id,
            outcome="DENIED",
            details={"service": body.service, "query": body.query},
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to execute session scope test",
        ) from exc

    record_audit_event(
        action="SCOPE_TEST_ALLOWED",
        actor_id=user.user_id,
        actor_role=user.role,
        resource_id=session_id,
        outcome="SUCCESS",
        details={
            "service": body.service,
            "query": body.query,
            "simulated": result.get("simulated", True),
        },
    )
    return {"session_id": session_id, **result}


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


# ---------------------------------------------------------------------------
# AIC-GATE Platform Master Admin Control Plane (/master-api/*)
# ---------------------------------------------------------------------------


@app.get("/master-api/orgs")
def master_list_orgs(
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    del master
    orgs = list_all_organizations()
    summaries: list[dict] = []
    for org in orgs:
        members = list_org_users(org.org_id)
        admins = [m for m in members if m.role == "admin"]
        owner = next(
            (m for m in admins if m.admin_tier == "owner"),
            admins[0] if admins else None,
        )
        summaries.append(
            {
                **_org_to_dict(org),
                "member_count": len(members),
                "admin_count": len(admins),
                "owner_username": owner.username if owner else "",
            }
        )
    return {"organizations": summaries}


@app.patch("/master-api/orgs/{org_id}")
def master_update_org(
    org_id: str,
    body: MasterOrgUpdateBody,
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    try:
        org = update_organization(
            org_id,
            org_name=body.org_name,
            allowed_domain=body.allowed_domain,
            status=body.status,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_audit_event(
        action="MASTER_ORG_UPDATED",
        actor_id=master.user_id,
        actor_role=master.role,
        resource_id=org.org_id,
        outcome="SUCCESS",
        details={
            "org_name": org.org_name,
            "allowed_domain": org.allowed_domain,
            "status": org.status,
        },
    )
    return _org_to_dict(org)


@app.get("/master-api/orgs/{org_id}/users")
def master_list_org_users(
    org_id: str,
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    del master
    org = get_organization(org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return {"users": [_member_to_dict(m) for m in list_org_users(org_id)]}


@app.post("/master-api/orgs/{org_id}/admins")
def master_set_org_admin(
    org_id: str,
    body: MasterSetAdminBody,
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    action_map = {
        "delegated": "PROMOTE_DELEGATED",
        "owner": "PROMOTE_OWNER",
        "none": "DEMOTE_REQUESTER",
    }
    try:
        updated = manage_org_member(
            org_id,
            body.username,
            actor_user_id=master.user_id,
            actor_is_owner=True,
            actor_is_master=True,
            admin_action=action_map[body.tier],  # type: ignore[arg-type]
        )
        if body.tier == "owner":
            update_organization(org_id, owner_user_id=updated.user_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    create_notification(
        user_id=updated.user_id,
        org_id=org_id,
        kind="ROLE_UPDATED",
        title="Platform Governance Update",
        message=f"AIC-GATE Master updated your admin tier to {body.tier.upper()}.",
        link="/admin/team" if updated.role == "admin" else "/client",
    )
    record_audit_event(
        action="MASTER_ORG_ADMIN_SET",
        actor_id=master.user_id,
        actor_role=master.role,
        resource_id=updated.user_id,
        outcome="SUCCESS",
        details={"org_id": org_id, "username": updated.username, "tier": body.tier},
    )
    return _member_to_dict(updated)


@app.post("/master-api/users/{username}/reset-mfa")
def master_reset_user_mfa(
    username: str,
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    try:
        updated = admin_reset_user_mfa(username)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    create_notification(
        user_id=updated.user_id,
        org_id=updated.org_id,
        kind="SUPPORT_TICKET",
        title="MFA Break-Glass Reset",
        message="AIC-GATE Platform Master reset your TOTP MFA enrollment.",
        link="/client",
    )
    record_audit_event(
        action="MASTER_MFA_RESET",
        actor_id=master.user_id,
        actor_role=master.role,
        resource_id=updated.user_id,
        outcome="SUCCESS",
        details={"username": updated.username},
    )
    return _member_to_dict(updated)


@app.get("/master-api/tickets")
def master_list_tickets(
    status: str | None = None,
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    del master
    return {"tickets": [_ticket_to_dict(t) for t in list_all_tickets(status=status)]}


@app.patch("/master-api/tickets/{ticket_id}")
def master_update_ticket(
    ticket_id: str,
    body: MasterTicketUpdateBody,
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    existing = get_support_ticket(ticket_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Support ticket not found.")

    applied_rename = False
    if (
        body.apply_org_rename
        and existing.category == "ORG_RENAME"
        and existing.requested_value.strip()
    ):
        try:
            update_organization(
                existing.org_id,
                org_name=existing.requested_value.strip(),
            )
            applied_rename = True
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        updated = update_support_ticket(
            ticket_id,
            status=body.status,
            resolution_note=body.resolution_note,
            resolved_by=master.username,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    create_notification(
        user_id=updated.created_by_user_id,
        org_id=updated.org_id,
        kind="SUPPORT_TICKET",
        title=f"Support Ticket {updated.status}",
        message=(
            f"{updated.subject}: {updated.resolution_note or updated.status}"
            + (" (Organization renamed)" if applied_rename else "")
        ),
        link="/admin/team",
    )
    record_audit_event(
        action="MASTER_TICKET_UPDATED",
        actor_id=master.user_id,
        actor_role=master.role,
        resource_id=ticket_id,
        outcome="SUCCESS",
        details={
            "status": updated.status,
            "org_id": updated.org_id,
            "applied_rename": applied_rename,
        },
    )
    return {**_ticket_to_dict(updated), "applied_rename": applied_rename}


@app.get("/master-api/audit")
def master_audit_feed(
    limit: int = Query(default=150, ge=1, le=500),
    master: AuthenticatedUser = Depends(require_platform_admin),
):
    del master
    return {"events": list_audit_events(limit=limit)}
