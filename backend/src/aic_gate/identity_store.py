"""Multi-tenant organization, profile, role, notification, and ticket store."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from functools import lru_cache
import json
import os
from pathlib import Path
import re
import secrets
from typing import Any, Literal
from uuid import uuid4

from botocore.exceptions import ClientError

from aic_gate.config import create_boto3_session, get_settings

UserRole = Literal["requester", "admin", "platform_admin"]
AdminTier = Literal["none", "delegated", "owner", "master"]
UserStatus = Literal["ACTIVE", "PENDING_APPROVAL", "REJECTED", "SUSPENDED"]
OrgStatus = Literal["ACTIVE", "SUSPENDED"]
RoleColor = Literal["cyan", "amber", "green", "volt", "red", "slate"]
TicketCategory = Literal[
    "ORG_RENAME",
    "ADMIN_ESCALATION",
    "MFA_RECOVERY",
    "SERVICE_CATALOG",
    "SECURITY_INCIDENT",
    "GENERAL",
]
TicketStatus = Literal["OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"]

DEFAULT_LAB_ORG_ID = "org-aicgate-lab"
DEFAULT_LAB_INVITE_CODE = "LAB-AICGATE-2026"
DEFAULT_PLATFORM_ORG_ID = "platform"

ALLOWED_AVATAR_PRESETS = frozenset(
    {"shield", "terminal", "hex", "cyber", "radar", "crown", "cpu", "lock"}
)
ALLOWED_ROLE_COLORS = frozenset({"cyan", "amber", "green", "volt", "red", "slate"})
_SAFE_IMAGE_DATA_URI_RE = re.compile(
    r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$"
)
_MAX_AVATAR_LEN = 200_000
_UNSET: Any = object()


@dataclass
class Organization:
    org_id: str
    org_name: str
    allowed_domain: str
    invite_code: str
    created_at: str
    created_by: str
    owner_user_id: str = ""
    status: OrgStatus = "ACTIVE"


@dataclass
class UserAccount:
    user_id: str
    org_id: str
    username: str
    email: str
    display_name: str
    department: str
    role: UserRole
    status: UserStatus
    password_hash: str
    mfa_enabled: bool = False
    mfa_secret: str | None = None
    mfa_pending_secret: str | None = None
    created_at: str = ""
    admin_tier: AdminTier = "none"
    bio: str = ""
    avatar: str = ""
    custom_role_id: str | None = None
    last_login_at: str | None = None
    previous_login_at: str | None = None


@dataclass
class OrgRole:
    role_id: str
    org_id: str
    name: str
    description: str
    color: str
    created_at: str
    created_by: str


@dataclass
class NotificationItem:
    notification_id: str
    user_id: str
    org_id: str
    kind: str
    title: str
    message: str
    created_at: str
    read: bool = False
    link: str = ""


@dataclass
class SupportTicket:
    ticket_id: str
    org_id: str
    org_name: str
    created_by_user_id: str
    created_by_username: str
    category: TicketCategory
    subject: str
    description: str
    requested_value: str = ""
    status: TicketStatus = "OPEN"
    resolution_note: str = ""
    resolved_by: str | None = None
    created_at: str = ""
    updated_at: str = ""


_mem_orgs: dict[str, Organization] = {}
_mem_users: dict[str, UserAccount] = {}
_mem_roles: dict[str, OrgRole] = {}
_mem_invites: dict[str, str] = {}
_mem_notifications: dict[str, NotificationItem] = {}
_mem_tickets: dict[str, SupportTicket] = {}


def _generate_invite_code() -> str:
    return f"ORG-{secrets.token_hex(4).upper()}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@lru_cache(maxsize=1)
def get_identity_table():
    settings = get_settings()
    dynamodb = create_boto3_session(settings.aws_data_profile).resource(
        "dynamodb"
    )
    return dynamodb.Table(settings.identity_table_name)


def _use_ddb() -> bool:
    return get_settings().identity_backend == "dynamodb"


def _use_file() -> bool:
    return get_settings().identity_backend == "file"


_file_loaded_path: str | None = None


def _ensure_file_loaded() -> None:
    global _file_loaded_path
    if not _use_file():
        return
    target = str(Path(get_settings().identity_file_path))
    if _file_loaded_path == target:
        return

    _mem_orgs.clear()
    _mem_users.clear()
    _mem_roles.clear()
    _mem_invites.clear()
    _mem_notifications.clear()
    _mem_tickets.clear()

    path_obj = Path(target)
    if path_obj.is_file():
        data = json.loads(path_obj.read_text(encoding="utf-8"))
        for raw in data.get("orgs", []):
            org = _item_to_org(raw)
            _mem_orgs[org.org_id] = org
        for raw in data.get("users", []):
            user = _item_to_user(raw)
            _mem_users[user.username] = user
        for raw in data.get("roles", []):
            role = _item_to_role(raw)
            _mem_roles[f"{role.org_id}#{role.role_id}"] = role
        for code, oid in data.get("invites", {}).items():
            _mem_invites[str(code).upper()] = str(oid)
        for raw in data.get("notifications", []):
            notif = _item_to_notif(raw)
            _mem_notifications[notif.notification_id] = notif
        for raw in data.get("tickets", []):
            tkt = _item_to_ticket(raw)
            _mem_tickets[tkt.ticket_id] = tkt

    _file_loaded_path = target


def _persist_file() -> None:
    global _file_loaded_path
    if not _use_file():
        return
    target = str(Path(get_settings().identity_file_path))
    path_obj = Path(target)
    path_obj.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "orgs": [_org_to_item(o) for o in _mem_orgs.values()],
        "users": [_user_to_item(u) for u in _mem_users.values()],
        "roles": [_role_to_item(r) for r in _mem_roles.values()],
        "invites": dict(_mem_invites),
        "notifications": [_notif_to_item(n) for n in _mem_notifications.values()],
        "tickets": [_ticket_to_item(t) for t in _mem_tickets.values()],
    }
    tmp_path = path_obj.with_suffix(".json.tmp")
    tmp_path.write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp_path, path_obj)
    _file_loaded_path = target


def _org_to_item(org: Organization) -> dict:
    item = asdict(org)
    item["pk"] = f"ORG#{org.org_id}"
    item["entity_type"] = "ORG"
    return item


def _item_to_org(item: dict) -> Organization:
    return Organization(
        org_id=item["org_id"],
        org_name=item["org_name"],
        allowed_domain=item.get("allowed_domain", ""),
        invite_code=item["invite_code"],
        created_at=item["created_at"],
        created_by=item["created_by"],
        owner_user_id=item.get("owner_user_id") or item.get("created_by", ""),
        status=item.get("status", "ACTIVE"),
    )


def _user_to_item(user: UserAccount) -> dict:
    item = asdict(user)
    item["pk"] = f"USER#{user.username}"
    item["entity_type"] = "USER"
    return item


def _item_to_user(item: dict) -> UserAccount:
    role: UserRole = item["role"]
    default_tier: AdminTier = (
        "master"
        if role == "platform_admin"
        else ("owner" if role == "admin" else "none")
    )
    return UserAccount(
        user_id=item["user_id"],
        org_id=item["org_id"],
        username=item["username"],
        email=item["email"],
        display_name=item["display_name"],
        department=item["department"],
        role=role,
        status=item["status"],
        password_hash=item["password_hash"],
        mfa_enabled=bool(item.get("mfa_enabled", False)),
        mfa_secret=item.get("mfa_secret"),
        mfa_pending_secret=item.get("mfa_pending_secret"),
        created_at=item.get("created_at", ""),
        admin_tier=item.get("admin_tier") or default_tier,
        bio=item.get("bio", ""),
        avatar=item.get("avatar", ""),
        custom_role_id=item.get("custom_role_id"),
        last_login_at=item.get("last_login_at"),
        previous_login_at=item.get("previous_login_at"),
    )


def _role_to_item(role: OrgRole) -> dict:
    item = asdict(role)
    item["pk"] = f"ROLE#{role.org_id}#{role.role_id}"
    item["entity_type"] = "ROLE"
    return item


def _item_to_role(item: dict) -> OrgRole:
    return OrgRole(
        role_id=item["role_id"],
        org_id=item["org_id"],
        name=item["name"],
        description=item.get("description", ""),
        color=item.get("color", "cyan"),
        created_at=item.get("created_at", ""),
        created_by=item.get("created_by", ""),
    )


def _notif_to_item(notif: NotificationItem) -> dict:
    item = asdict(notif)
    item["pk"] = f"NOTIF#{notif.user_id}#{notif.notification_id}"
    item["entity_type"] = "NOTIF"
    return item


def _item_to_notif(item: dict) -> NotificationItem:
    return NotificationItem(
        notification_id=item["notification_id"],
        user_id=item["user_id"],
        org_id=item["org_id"],
        kind=item["kind"],
        title=item["title"],
        message=item["message"],
        created_at=item["created_at"],
        read=bool(item.get("read", False)),
        link=item.get("link", ""),
    )


def _ticket_to_item(ticket: SupportTicket) -> dict:
    item = asdict(ticket)
    item["pk"] = f"TICKET#{ticket.ticket_id}"
    item["entity_type"] = "TICKET"
    return item


def _item_to_ticket(item: dict) -> SupportTicket:
    return SupportTicket(
        ticket_id=item["ticket_id"],
        org_id=item["org_id"],
        org_name=item.get("org_name", ""),
        created_by_user_id=item["created_by_user_id"],
        created_by_username=item.get("created_by_username", ""),
        category=item["category"],
        subject=item["subject"],
        description=item["description"],
        requested_value=item.get("requested_value", ""),
        status=item.get("status", "OPEN"),
        resolution_note=item.get("resolution_note", ""),
        resolved_by=item.get("resolved_by"),
        created_at=item.get("created_at", ""),
        updated_at=item.get("updated_at", ""),
    )


def _scan_entity_type(entity_type: str, extra_filter: str = "", extra_values: dict | None = None) -> list[dict]:
    table = get_identity_table()
    values: dict[str, Any] = {":et": entity_type}
    if extra_values:
        values.update(extra_values)
    filter_expr = "entity_type = :et"
    if extra_filter:
        filter_expr = f"{filter_expr} AND {extra_filter}"

    items: list[dict] = []
    scan_args: dict[str, Any] = {
        "FilterExpression": filter_expr,
        "ExpressionAttributeValues": values,
    }
    while True:
        resp = table.scan(**scan_args)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_args["ExclusiveStartKey"] = last_key
    return items


def reset_identity_store() -> None:
    """Clear in-memory identity records (for test isolation)."""
    global _file_loaded_path
    _mem_orgs.clear()
    _mem_users.clear()
    _mem_roles.clear()
    _mem_invites.clear()
    _mem_notifications.clear()
    _mem_tickets.clear()
    _file_loaded_path = None


def _reserve_unique_invite_code(
    org_id: str,
    preferred: str | None = None,
) -> str:
    """Reserve a globally unique, non-reusable organization invite code."""
    _ensure_file_loaded()
    for attempt in range(25):
        candidate = (
            preferred.strip().upper()
            if (attempt == 0 and preferred)
            else _generate_invite_code()
        )
        if not _use_ddb():
            if candidate in _mem_invites:
                continue
            # Also check any existing orgs loaded directly in memory
            if any(o.invite_code.upper() == candidate for o in _mem_orgs.values()):
                _mem_invites[candidate] = "RESERVED"
                continue
            _mem_invites[candidate] = org_id
            _persist_file()
            return candidate

        try:
            get_identity_table().put_item(
                Item={
                    "pk": f"INVITE#{candidate}",
                    "entity_type": "INVITE",
                    "invite_code": candidate,
                    "org_id": org_id,
                    "created_at": _now_iso(),
                },
                ConditionExpression="attribute_not_exists(pk)",
            )
            return candidate
        except ClientError as exc:
            if (
                exc.response.get("Error", {}).get("Code")
                == "ConditionalCheckFailedException"
            ):
                continue
            raise

    raise RuntimeError("Unable to allocate a unique organization invite code.")


def seed_default_lab(
    *,
    requester_password_hash: str,
    admin_password_hash: str,
    master_password_hash: str | None = None,
) -> None:
    """Idempotently seed the default AIC-GATE lab org, demo accounts, and roles."""
    _ensure_file_loaded()
    now = _now_iso()
    if get_organization(DEFAULT_LAB_ORG_ID) is None:
        invite_code = _reserve_unique_invite_code(
            DEFAULT_LAB_ORG_ID,
            preferred=DEFAULT_LAB_INVITE_CODE,
        )
        lab_org = Organization(
            org_id=DEFAULT_LAB_ORG_ID,
            org_name="AIC-GATE Security Lab",
            allowed_domain="aicgate.local",
            invite_code=invite_code,
            created_at=now,
            created_by="usr-admin-01",
            owner_user_id="usr-admin-01",
            status="ACTIVE",
        )
        _save_org(lab_org)

    if get_user("operator") is None:
        _save_user(
            UserAccount(
                user_id="usr-operator-01",
                org_id=DEFAULT_LAB_ORG_ID,
                username="operator",
                email="operator@aicgate.local",
                display_name="Field Operator",
                department="Cloud Operations",
                role="requester",
                status="ACTIVE",
                password_hash=requester_password_hash,
                created_at=now,
                admin_tier="none",
                bio="Cloud operations engineer requesting scoped JIT AWS sessions.",
                avatar="preset:terminal",
            )
        )

    if get_user("commander") is None:
        _save_user(
            UserAccount(
                user_id="usr-admin-01",
                org_id=DEFAULT_LAB_ORG_ID,
                username="commander",
                email="commander@aicgate.local",
                display_name="Security Commander",
                department="Identity Governance",
                role="admin",
                status="ACTIVE",
                password_hash=admin_password_hash,
                created_at=now,
                admin_tier="owner",
                bio="Primary security owner for the AIC-GATE lab tenant.",
                avatar="preset:shield",
            )
        )

    if master_password_hash and get_user("master") is None:
        _save_user(
            UserAccount(
                user_id="usr-master-01",
                org_id=DEFAULT_PLATFORM_ORG_ID,
                username="master",
                email="master@aicgate.io",
                display_name="AIC-GATE Platform Master",
                department="Platform Governance",
                role="platform_admin",
                status="ACTIVE",
                password_hash=master_password_hash,
                created_at=now,
                admin_tier="master",
                bio="Non-organizational platform governance & tenant support authority.",
                avatar="preset:crown",
            )
        )

    if not list_org_roles(DEFAULT_LAB_ORG_ID):
        default_roles = (
            OrgRole(
                role_id="role-cloud-sre",
                org_id=DEFAULT_LAB_ORG_ID,
                name="Cloud SRE",
                description="Site reliability & production log inspection",
                color="cyan",
                created_at=now,
                created_by="usr-admin-01",
            ),
            OrgRole(
                role_id="role-sec-auditor",
                org_id=DEFAULT_LAB_ORG_ID,
                name="Security Auditor",
                description="Read-only telemetry and compliance verification",
                color="amber",
                created_at=now,
                created_by="usr-admin-01",
            ),
            OrgRole(
                role_id="role-jr-intern",
                org_id=DEFAULT_LAB_ORG_ID,
                name="Junior Intern",
                description="Supervised sandbox and non-production access",
                color="green",
                created_at=now,
                created_by="usr-admin-01",
            ),
        )
        for role in default_roles:
            _save_role(role)


def _save_org(org: Organization, *, must_not_exist: bool = False) -> None:
    if not _use_ddb():
        _ensure_file_loaded()
        if must_not_exist and org.org_id in _mem_orgs:
            raise ValueError("Organization already exists.")
        _mem_orgs[org.org_id] = org
        _persist_file()
        return

    kwargs: dict[str, Any] = {"Item": _org_to_item(org)}
    if must_not_exist:
        kwargs["ConditionExpression"] = "attribute_not_exists(pk)"
    try:
        get_identity_table().put_item(**kwargs)
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            == "ConditionalCheckFailedException"
        ):
            raise ValueError("Organization already exists.") from exc
        raise


def _save_user(user: UserAccount, *, must_not_exist: bool = False) -> None:
    if not _use_ddb():
        _ensure_file_loaded()
        if must_not_exist and user.username in _mem_users:
            raise ValueError("Username is already taken.")
        _mem_users[user.username] = user
        _persist_file()
        return

    kwargs: dict[str, Any] = {"Item": _user_to_item(user)}
    if must_not_exist:
        kwargs["ConditionExpression"] = "attribute_not_exists(pk)"
    try:
        get_identity_table().put_item(**kwargs)
    except ClientError as exc:
        if (
            exc.response.get("Error", {}).get("Code")
            == "ConditionalCheckFailedException"
        ):
            raise ValueError("Username is already taken.") from exc
        raise


def _save_role(role: OrgRole) -> None:
    if not _use_ddb():
        _ensure_file_loaded()
        _mem_roles[f"{role.org_id}#{role.role_id}"] = role
        _persist_file()
        return
    get_identity_table().put_item(Item=_role_to_item(role))


def get_organization(org_id: str) -> Organization | None:
    if not org_id or org_id == DEFAULT_PLATFORM_ORG_ID:
        return None
    if not _use_ddb():
        _ensure_file_loaded()
        return _mem_orgs.get(org_id)

    resp = get_identity_table().get_item(
        Key={"pk": f"ORG#{org_id}"},
        ConsistentRead=True,
    )
    item = resp.get("Item")
    return _item_to_org(item) if item else None


def list_all_organizations() -> list[Organization]:
    if not _use_ddb():
        _ensure_file_loaded()
        orgs = list(_mem_orgs.values())
        orgs.sort(key=lambda o: o.created_at, reverse=True)
        return orgs

    orgs = [_item_to_org(i) for i in _scan_entity_type("ORG")]
    orgs.sort(key=lambda o: o.created_at, reverse=True)
    return orgs


def find_organization_by_invite_code(invite_code: str) -> Organization | None:
    code = invite_code.strip().upper()
    if not code:
        return None

    if not _use_ddb():
        _ensure_file_loaded()
        for org in _mem_orgs.values():
            if org.invite_code.upper() == code:
                return org
        return None

    items = _scan_entity_type(
        "ORG",
        extra_filter="invite_code = :code",
        extra_values={":code": code},
    )
    return _item_to_org(items[0]) if items else None


def rotate_org_invite_code(org_id: str) -> Organization:
    org = get_organization(org_id)
    if org is None:
        raise LookupError("Organization not found.")

    new_code = _reserve_unique_invite_code(org_id)
    if not _use_ddb():
        org.invite_code = new_code
        _persist_file()
        return org

    get_identity_table().update_item(
        Key={"pk": f"ORG#{org_id}"},
        UpdateExpression="SET invite_code = :code",
        ExpressionAttributeValues={":code": new_code},
        ConditionExpression="attribute_exists(pk)",
    )
    org.invite_code = new_code
    return org


def update_organization(
    org_id: str,
    *,
    org_name: str | None = None,
    allowed_domain: str | None = None,
    status: OrgStatus | None = None,
    owner_user_id: str | None = None,
) -> Organization:
    org = get_organization(org_id)
    if org is None:
        raise LookupError("Organization not found.")

    next_name = org.org_name
    if org_name is not None:
        clean_name = org_name.strip()
        if len(clean_name) < 2 or len(clean_name) > 80:
            raise ValueError(
                "Organization name must be between 2 and 80 characters."
            )
        next_name = clean_name

    next_domain = org.allowed_domain
    if allowed_domain is not None:
        clean_dom = allowed_domain.strip().lower().lstrip("@")
        if clean_dom and (" " in clean_dom or "." not in clean_dom):
            raise ValueError("Allowed domain must be a valid hostname (e.g. acme.io).")
        next_domain = clean_dom

    next_status = status if status is not None else org.status
    if next_status not in ("ACTIVE", "SUSPENDED"):
        raise ValueError("Organization status must be ACTIVE or SUSPENDED.")

    next_owner = owner_user_id if owner_user_id is not None else org.owner_user_id

    if not _use_ddb():
        org.org_name = next_name
        org.allowed_domain = next_domain
        org.status = next_status
        org.owner_user_id = next_owner
        _persist_file()
        return org

    get_identity_table().update_item(
        Key={"pk": f"ORG#{org_id}"},
        UpdateExpression=(
            "SET org_name = :name, allowed_domain = :dom, "
            "#status = :status, owner_user_id = :owner"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":name": next_name,
            ":dom": next_domain,
            ":status": next_status,
            ":owner": next_owner,
        },
        ConditionExpression="attribute_exists(pk)",
    )
    org.org_name = next_name
    org.allowed_domain = next_domain
    org.status = next_status
    org.owner_user_id = next_owner
    return org


def get_user(username: str) -> UserAccount | None:
    normalized = username.strip().lower()
    if not normalized:
        return None

    if not _use_ddb():
        _ensure_file_loaded()
        return _mem_users.get(normalized)

    resp = get_identity_table().get_item(
        Key={"pk": f"USER#{normalized}"},
        ConsistentRead=True,
    )
    item = resp.get("Item")
    return _item_to_user(item) if item else None


def get_user_by_id(user_id: str) -> UserAccount | None:
    if not user_id:
        return None
    if not _use_ddb():
        _ensure_file_loaded()
        for u in _mem_users.values():
            if u.user_id == user_id:
                return u
        return None

    items = _scan_entity_type(
        "USER",
        extra_filter="user_id = :uid",
        extra_values={":uid": user_id},
    )
    return _item_to_user(items[0]) if items else None


def list_platform_admins() -> list[UserAccount]:
    if not _use_ddb():
        _ensure_file_loaded()
        return [
            u
            for u in _mem_users.values()
            if u.role == "platform_admin" and u.status == "ACTIVE"
        ]

    all_users = [_item_to_user(i) for i in _scan_entity_type("USER")]
    return [
        u for u in all_users if u.role == "platform_admin" and u.status == "ACTIVE"
    ]


def create_organization(
    *,
    org_name: str,
    allowed_domain: str,
    admin_username: str,
    admin_email: str,
    admin_display_name: str,
    admin_department: str,
    admin_password_hash: str,
) -> tuple[Organization, UserAccount]:
    clean_org = org_name.strip()
    clean_user = admin_username.strip().lower()
    clean_email = admin_email.strip().lower()
    clean_domain = allowed_domain.strip().lower().lstrip("@")

    if not clean_org or len(clean_org) < 2:
        raise ValueError("Organization name must be at least 2 characters.")
    if not clean_user or len(clean_user) < 3 or " " in clean_user:
        raise ValueError("Admin username must be at least 3 chars without spaces.")
    if "@" not in clean_email:
        raise ValueError("A valid admin email is required.")
    if clean_domain and not clean_email.endswith(f"@{clean_domain}"):
        raise ValueError(
            f"Admin email must belong to organization domain @{clean_domain}."
        )
    if get_user(clean_user) is not None:
        raise ValueError("Username is already taken.")

    org_id = f"org-{uuid4().hex[:10]}"
    admin_id = f"usr-{uuid4().hex[:10]}"
    now = _now_iso()
    invite_code = _reserve_unique_invite_code(org_id)

    org = Organization(
        org_id=org_id,
        org_name=clean_org,
        allowed_domain=clean_domain,
        invite_code=invite_code,
        created_at=now,
        created_by=admin_id,
        owner_user_id=admin_id,
        status="ACTIVE",
    )
    admin = UserAccount(
        user_id=admin_id,
        org_id=org_id,
        username=clean_user,
        email=clean_email,
        display_name=admin_display_name.strip() or clean_user,
        department=admin_department.strip() or "Security Administration",
        role="admin",
        status="ACTIVE",
        password_hash=admin_password_hash,
        created_at=now,
        admin_tier="owner",
        avatar="preset:shield",
    )

    _save_org(org, must_not_exist=True)
    _save_user(admin, must_not_exist=True)
    return org, admin


def create_member_signup(
    *,
    org_id: str,
    username: str,
    email: str,
    display_name: str,
    department: str,
    password_hash: str,
) -> UserAccount:
    org = get_organization(org_id)
    if org is None:
        raise LookupError("Organization not found.")
    if org.status == "SUSPENDED":
        raise ValueError("Organization is currently suspended.")

    clean_user = username.strip().lower()
    clean_email = email.strip().lower()

    if not clean_user or len(clean_user) < 3 or " " in clean_user:
        raise ValueError("Username must be at least 3 characters without spaces.")
    if "@" not in clean_email:
        raise ValueError("A valid corporate email is required.")
    if org.allowed_domain and not clean_email.endswith(f"@{org.allowed_domain}"):
        raise ValueError(
            f"Email must match organization domain @{org.allowed_domain}."
        )
    if get_user(clean_user) is not None:
        raise ValueError("Username is already taken.")

    user = UserAccount(
        user_id=f"usr-{uuid4().hex[:10]}",
        org_id=org.org_id,
        username=clean_user,
        email=clean_email,
        display_name=display_name.strip() or clean_user,
        department=department.strip() or "Engineering",
        role="requester",
        status="PENDING_APPROVAL",
        password_hash=password_hash,
        created_at=_now_iso(),
        admin_tier="none",
        avatar="preset:terminal",
    )
    _save_user(user, must_not_exist=True)
    return user


def list_org_users(org_id: str) -> list[UserAccount]:
    if not _use_ddb():
        _ensure_file_loaded()
        users = [u for u in _mem_users.values() if u.org_id == org_id]
        users.sort(key=lambda u: u.created_at, reverse=True)
        return users

    items = _scan_entity_type(
        "USER",
        extra_filter="org_id = :org",
        extra_values={":org": org_id},
    )
    users = [_item_to_user(i) for i in items]
    users.sort(key=lambda u: u.created_at, reverse=True)
    return users


def review_user_account(
    org_id: str,
    username: str,
    decision: Literal["ACTIVE", "REJECTED"],
) -> UserAccount:
    if decision not in ("ACTIVE", "REJECTED"):
        raise ValueError("Decision must be ACTIVE or REJECTED.")

    user = get_user(username)
    if user is None or user.org_id != org_id:
        raise LookupError("Member not found in your organization.")
    if user.status != "PENDING_APPROVAL":
        raise ValueError("Only pending member signups can be reviewed.")

    if not _use_ddb():
        user.status = decision
        _persist_file()
        return user

    get_identity_table().update_item(
        Key={"pk": f"USER#{user.username}"},
        UpdateExpression="SET #status = :status",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": decision,
            ":expected": "PENDING_APPROVAL",
        },
        ConditionExpression="#status = :expected",
    )
    user.status = decision
    return user


def record_user_login(username: str) -> tuple[str | None, str]:
    user = get_user(username)
    if user is None:
        raise LookupError("User not found.")

    prev = user.last_login_at
    now = _now_iso()
    if not _use_ddb():
        user.previous_login_at = prev
        user.last_login_at = now
        _persist_file()
        return prev, now

    get_identity_table().update_item(
        Key={"pk": f"USER#{user.username}"},
        UpdateExpression="SET previous_login_at = :prev, last_login_at = :now",
        ExpressionAttributeValues={":prev": prev, ":now": now},
        ConditionExpression="attribute_exists(pk)",
    )
    user.previous_login_at = prev
    user.last_login_at = now
    return prev, now


def _validate_avatar(avatar: str) -> str:
    clean = avatar.strip()
    if not clean:
        return ""
    if clean.startswith("preset:"):
        preset = clean.split(":", 1)[1]
        if preset not in ALLOWED_AVATAR_PRESETS:
            raise ValueError("Unsupported avatar preset.")
        return clean
    if len(clean) > _MAX_AVATAR_LEN:
        raise ValueError("Avatar image exceeds 200 KB encoded limit.")
    if not _SAFE_IMAGE_DATA_URI_RE.fullmatch(clean):
        raise ValueError(
            "Avatar must be a built-in preset or PNG/JPEG/WEBP data URI."
        )
    return clean


def update_user_profile(
    username: str,
    *,
    display_name: str | None = None,
    bio: str | None = None,
    avatar: str | None = None,
) -> UserAccount:
    user = get_user(username)
    if user is None:
        raise LookupError("User not found.")

    next_display = user.display_name
    if display_name is not None:
        clean_dn = display_name.strip()
        if not clean_dn or len(clean_dn) > 80:
            raise ValueError("Display name must be 1 to 80 characters.")
        next_display = clean_dn

    next_bio = user.bio
    if bio is not None:
        clean_bio = bio.strip()
        if len(clean_bio) > 240:
            raise ValueError("Bio must be 240 characters or fewer.")
        next_bio = clean_bio

    next_avatar = user.avatar
    if avatar is not None:
        next_avatar = _validate_avatar(avatar)

    if not _use_ddb():
        user.display_name = next_display
        user.bio = next_bio
        user.avatar = next_avatar
        _persist_file()
        return user

    get_identity_table().update_item(
        Key={"pk": f"USER#{user.username}"},
        UpdateExpression="SET display_name = :dn, bio = :bio, avatar = :av",
        ExpressionAttributeValues={
            ":dn": next_display,
            ":bio": next_bio,
            ":av": next_avatar,
        },
        ConditionExpression="attribute_exists(pk)",
    )
    user.display_name = next_display
    user.bio = next_bio
    user.avatar = next_avatar
    return user


def manage_org_member(
    org_id: str,
    username: str,
    *,
    actor_user_id: str,
    actor_is_owner: bool,
    actor_is_master: bool = False,
    department: str | None = None,
    status: Literal["ACTIVE", "SUSPENDED"] | None = None,
    custom_role_id: str | None = _UNSET,
    admin_action: Literal[
        "PROMOTE_DELEGATED", "DEMOTE_REQUESTER", "PROMOTE_OWNER"
    ]
    | None = None,
) -> UserAccount:
    target = get_user(username)
    if target is None or target.org_id != org_id:
        raise LookupError("Member not found in organization.")

    if target.status == "PENDING_APPROVAL":
        raise ValueError("Approve or reject pending member before managing.")

    if (
        not actor_is_master
        and target.admin_tier == "owner"
        and target.user_id != actor_user_id
    ):
        raise PermissionError("Only Master Admin can modify another Org Owner.")

    if target.user_id == actor_user_id and (status == "SUSPENDED" or admin_action):
        raise ValueError("You cannot suspend or change your own admin status.")

    next_dept = target.department
    if department is not None:
        clean_dept = department.strip()
        if not clean_dept or len(clean_dept) > 60:
            raise ValueError("Department must be 1 to 60 characters.")
        next_dept = clean_dept

    next_status = target.status
    if status is not None:
        if status not in ("ACTIVE", "SUSPENDED"):
            raise ValueError("Status must be ACTIVE or SUSPENDED.")
        if target.admin_tier == "owner" and not actor_is_master:
            raise PermissionError("Org Owner cannot be suspended by org admins.")
        next_status = status

    next_custom_role = target.custom_role_id
    if custom_role_id is not _UNSET:
        if custom_role_id is None or custom_role_id == "":
            next_custom_role = None
        else:
            role_obj = get_org_role(org_id, custom_role_id)
            if role_obj is None:
                raise LookupError("Custom role not found in organization.")
            next_custom_role = role_obj.role_id

    next_role = target.role
    next_tier = target.admin_tier
    if admin_action is not None:
        if not actor_is_owner and not actor_is_master:
            raise PermissionError(
                "Only the Organization Owner or Master Admin can change admin tiers."
            )
        if admin_action == "PROMOTE_DELEGATED":
            if target.admin_tier == "owner" and not actor_is_master:
                raise PermissionError(
                    "Delegation cannot downgrade an existing Org Owner."
                )
            next_role = "admin"
            next_tier = "delegated"
        elif admin_action == "DEMOTE_REQUESTER":
            if target.admin_tier == "owner" and not actor_is_master:
                raise PermissionError(
                    "Only Master Admin can demote an Organization Owner."
                )
            next_role = "requester"
            next_tier = "none"
        elif admin_action == "PROMOTE_OWNER":
            if not actor_is_master:
                raise PermissionError(
                    "Only Master Admin can grant Organization Owner tier."
                )
            next_role = "admin"
            next_tier = "owner"
        else:
            raise ValueError("Unsupported admin action.")

    if not _use_ddb():
        target.department = next_dept
        target.status = next_status
        target.custom_role_id = next_custom_role
        target.role = next_role
        target.admin_tier = next_tier
        _persist_file()
        return target

    get_identity_table().update_item(
        Key={"pk": f"USER#{target.username}"},
        UpdateExpression=(
            "SET department = :dept, #status = :status, "
            "custom_role_id = :crid, #role = :role, admin_tier = :tier"
        ),
        ExpressionAttributeNames={"#status": "status", "#role": "role"},
        ExpressionAttributeValues={
            ":dept": next_dept,
            ":status": next_status,
            ":crid": next_custom_role,
            ":role": next_role,
            ":tier": next_tier,
        },
        ConditionExpression="attribute_exists(pk)",
    )
    target.department = next_dept
    target.status = next_status
    target.custom_role_id = next_custom_role
    target.role = next_role
    target.admin_tier = next_tier
    return target


def update_user_mfa(
    username: str,
    *,
    mfa_enabled: bool,
    mfa_secret: str | None,
    mfa_pending_secret: str | None,
) -> UserAccount:
    user = get_user(username)
    if user is None:
        raise LookupError("User not found.")

    if not _use_ddb():
        user.mfa_enabled = mfa_enabled
        user.mfa_secret = mfa_secret
        user.mfa_pending_secret = mfa_pending_secret
        _persist_file()
        return user

    get_identity_table().update_item(
        Key={"pk": f"USER#{user.username}"},
        UpdateExpression=(
            "SET mfa_enabled = :enabled, "
            "mfa_secret = :secret, "
            "mfa_pending_secret = :pending"
        ),
        ExpressionAttributeValues={
            ":enabled": mfa_enabled,
            ":secret": mfa_secret,
            ":pending": mfa_pending_secret,
        },
        ConditionExpression="attribute_exists(pk)",
    )
    user.mfa_enabled = mfa_enabled
    user.mfa_secret = mfa_secret
    user.mfa_pending_secret = mfa_pending_secret
    return user


# ---------------------------------------------------------------------------
# Custom Organization Roles
# ---------------------------------------------------------------------------


def list_org_roles(org_id: str) -> list[OrgRole]:
    if not _use_ddb():
        _ensure_file_loaded()
        roles = [r for r in _mem_roles.values() if r.org_id == org_id]
        roles.sort(key=lambda r: r.created_at)
        return roles

    items = _scan_entity_type(
        "ROLE",
        extra_filter="org_id = :org",
        extra_values={":org": org_id},
    )
    roles = [_item_to_role(i) for i in items]
    roles.sort(key=lambda r: r.created_at)
    return roles


def get_org_role(org_id: str, role_id: str) -> OrgRole | None:
    if not org_id or not role_id:
        return None
    if not _use_ddb():
        _ensure_file_loaded()
        return _mem_roles.get(f"{org_id}#{role_id}")

    resp = get_identity_table().get_item(
        Key={"pk": f"ROLE#{org_id}#{role_id}"},
        ConsistentRead=True,
    )
    item = resp.get("Item")
    return _item_to_role(item) if item else None


def create_org_role(
    org_id: str,
    *,
    name: str,
    description: str,
    color: str,
    created_by: str,
) -> OrgRole:
    clean_name = name.strip()
    if len(clean_name) < 2 or len(clean_name) > 40:
        raise ValueError("Role name must be 2 to 40 characters.")
    clean_color = color.strip().lower() or "cyan"
    if clean_color not in ALLOWED_ROLE_COLORS:
        raise ValueError("Invalid role badge color.")

    existing = list_org_roles(org_id)
    if any(r.name.lower() == clean_name.lower() for r in existing):
        raise ValueError("A role with this name already exists.")

    role = OrgRole(
        role_id=f"role-{uuid4().hex[:8]}",
        org_id=org_id,
        name=clean_name,
        description=description.strip()[:160],
        color=clean_color,
        created_at=_now_iso(),
        created_by=created_by,
    )
    _save_role(role)
    return role


def update_org_role(
    org_id: str,
    role_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    color: str | None = None,
) -> OrgRole:
    role = get_org_role(org_id, role_id)
    if role is None:
        raise LookupError("Role not found.")

    next_name = role.name
    if name is not None:
        clean_name = name.strip()
        if len(clean_name) < 2 or len(clean_name) > 40:
            raise ValueError("Role name must be 2 to 40 characters.")
        if any(
            r.role_id != role_id and r.name.lower() == clean_name.lower()
            for r in list_org_roles(org_id)
        ):
            raise ValueError("Another role already uses this name.")
        next_name = clean_name

    next_desc = role.description if description is None else description.strip()[:160]
    next_color = role.color
    if color is not None:
        clean_color = color.strip().lower()
        if clean_color not in ALLOWED_ROLE_COLORS:
            raise ValueError("Invalid role badge color.")
        next_color = clean_color

    if not _use_ddb():
        role.name = next_name
        role.description = next_desc
        role.color = next_color
        _persist_file()
        return role

    get_identity_table().update_item(
        Key={"pk": f"ROLE#{org_id}#{role_id}"},
        UpdateExpression="SET #name = :n, description = :d, color = :c",
        ExpressionAttributeNames={"#name": "name"},
        ExpressionAttributeValues={
            ":n": next_name,
            ":d": next_desc,
            ":c": next_color,
        },
        ConditionExpression="attribute_exists(pk)",
    )
    role.name = next_name
    role.description = next_desc
    role.color = next_color
    return role


def delete_org_role(org_id: str, role_id: str) -> None:
    role = get_org_role(org_id, role_id)
    if role is None:
        raise LookupError("Role not found.")

    members = list_org_users(org_id)
    affected = [m.username for m in members if m.custom_role_id == role_id]
    if affected:
        assign_role_to_users(org_id, None, affected)

    if not _use_ddb():
        _mem_roles.pop(f"{org_id}#{role_id}", None)
        _persist_file()
        return

    get_identity_table().delete_item(Key={"pk": f"ROLE#{org_id}#{role_id}"})


def assign_role_to_users(
    org_id: str,
    role_id: str | None,
    usernames: list[str],
) -> list[UserAccount]:
    if role_id is not None:
        role = get_org_role(org_id, role_id)
        if role is None:
            raise LookupError("Custom role not found in organization.")

    updated: list[UserAccount] = []
    for raw_name in usernames:
        user = get_user(raw_name)
        if user is None or user.org_id != org_id:
            continue
        if not _use_ddb():
            user.custom_role_id = role_id
        else:
            get_identity_table().update_item(
                Key={"pk": f"USER#{user.username}"},
                UpdateExpression="SET custom_role_id = :crid",
                ExpressionAttributeValues={":crid": role_id},
                ConditionExpression="attribute_exists(pk)",
            )
            user.custom_role_id = role_id
        updated.append(user)
    if updated and not _use_ddb():
        _persist_file()
    return updated


def resolve_user_role_meta(account: UserAccount) -> dict[str, str | None]:
    custom_role: OrgRole | None = None
    if account.custom_role_id and account.org_id != DEFAULT_PLATFORM_ORG_ID:
        custom_role = get_org_role(account.org_id, account.custom_role_id)

    if custom_role is not None:
        return {
            "custom_role_id": custom_role.role_id,
            "custom_role_name": custom_role.name,
            "custom_role_color": custom_role.color,
            "effective_role": custom_role.name,
        }

    if account.role == "platform_admin":
        default_label = "Master Admin"
        default_color = "volt"
    elif account.role == "admin":
        default_label = "Org Owner" if account.admin_tier == "owner" else "Org Admin"
        default_color = "amber"
    else:
        default_label = "Requester"
        default_color = "cyan"

    return {
        "custom_role_id": None,
        "custom_role_name": None,
        "custom_role_color": default_color,
        "effective_role": default_label,
    }


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def create_notification(
    *,
    user_id: str,
    org_id: str,
    kind: str,
    title: str,
    message: str,
    link: str = "",
) -> NotificationItem:
    notif = NotificationItem(
        notification_id=f"ntf-{uuid4().hex[:10]}",
        user_id=user_id,
        org_id=org_id,
        kind=kind,
        title=title,
        message=message,
        created_at=_now_iso(),
        read=False,
        link=link,
    )
    if not _use_ddb():
        _ensure_file_loaded()
        _mem_notifications[notif.notification_id] = notif
        _persist_file()
        return notif

    get_identity_table().put_item(Item=_notif_to_item(notif))
    return notif


def notify_org_admins(
    *,
    org_id: str,
    kind: str,
    title: str,
    message: str,
    link: str = "",
) -> None:
    for member in list_org_users(org_id):
        if member.role == "admin" and member.status == "ACTIVE":
            create_notification(
                user_id=member.user_id,
                org_id=org_id,
                kind=kind,
                title=title,
                message=message,
                link=link,
            )


def notify_platform_admins(
    *,
    kind: str,
    title: str,
    message: str,
    link: str = "",
) -> None:
    for admin in list_platform_admins():
        create_notification(
            user_id=admin.user_id,
            org_id=DEFAULT_PLATFORM_ORG_ID,
            kind=kind,
            title=title,
            message=message,
            link=link,
        )


def list_user_notifications(
    user_id: str,
    limit: int = 40,
) -> list[NotificationItem]:
    if not _use_ddb():
        _ensure_file_loaded()
        items = [n for n in _mem_notifications.values() if n.user_id == user_id]
        items.sort(key=lambda n: n.created_at, reverse=True)
        return items[:limit]

    raw = _scan_entity_type(
        "NOTIF",
        extra_filter="user_id = :uid",
        extra_values={":uid": user_id},
    )
    items = [_item_to_notif(i) for i in raw]
    items.sort(key=lambda n: n.created_at, reverse=True)
    return items[:limit]


def mark_notifications_read(
    user_id: str,
    notification_id: str | None = None,
) -> int:
    items = list_user_notifications(user_id, limit=200)
    targets = [
        n
        for n in items
        if not n.read and (notification_id is None or n.notification_id == notification_id)
    ]
    for notif in targets:
        if not _use_ddb():
            notif.read = True
        else:
            get_identity_table().update_item(
                Key={"pk": f"NOTIF#{user_id}#{notif.notification_id}"},
                UpdateExpression="SET #read = :r",
                ExpressionAttributeNames={"#read": "read"},
                ExpressionAttributeValues={":r": True},
            )
    if targets and not _use_ddb():
        _persist_file()
    return len(targets)


# ---------------------------------------------------------------------------
# Master Admin Support Tickets
# ---------------------------------------------------------------------------


def create_support_ticket(
    *,
    org_id: str,
    org_name: str,
    created_by_user_id: str,
    created_by_username: str,
    category: TicketCategory,
    subject: str,
    description: str,
    requested_value: str = "",
) -> SupportTicket:
    clean_subj = subject.strip()
    clean_desc = description.strip()
    if len(clean_subj) < 3 or len(clean_subj) > 120:
        raise ValueError("Ticket subject must be 3 to 120 characters.")
    if len(clean_desc) < 5 or len(clean_desc) > 1000:
        raise ValueError("Ticket description must be 5 to 1000 characters.")

    now = _now_iso()
    ticket = SupportTicket(
        ticket_id=f"tkt-{uuid4().hex[:8]}",
        org_id=org_id,
        org_name=org_name,
        created_by_user_id=created_by_user_id,
        created_by_username=created_by_username,
        category=category,
        subject=clean_subj,
        description=clean_desc,
        requested_value=requested_value.strip()[:120],
        status="OPEN",
        created_at=now,
        updated_at=now,
    )
    if not _use_ddb():
        _ensure_file_loaded()
        _mem_tickets[ticket.ticket_id] = ticket
        _persist_file()
        return ticket

    get_identity_table().put_item(Item=_ticket_to_item(ticket))
    return ticket


def list_org_tickets(org_id: str) -> list[SupportTicket]:
    if not _use_ddb():
        _ensure_file_loaded()
        tickets = [t for t in _mem_tickets.values() if t.org_id == org_id]
        tickets.sort(key=lambda t: t.created_at, reverse=True)
        return tickets

    raw = _scan_entity_type(
        "TICKET",
        extra_filter="org_id = :org",
        extra_values={":org": org_id},
    )
    tickets = [_item_to_ticket(i) for i in raw]
    tickets.sort(key=lambda t: t.created_at, reverse=True)
    return tickets


def list_all_tickets(status: str | None = None) -> list[SupportTicket]:
    if not _use_ddb():
        _ensure_file_loaded()
        tickets = list(_mem_tickets.values())
    else:
        tickets = [_item_to_ticket(i) for i in _scan_entity_type("TICKET")]

    if status:
        tickets = [t for t in tickets if t.status == status]
    tickets.sort(key=lambda t: t.created_at, reverse=True)
    return tickets


def get_support_ticket(ticket_id: str) -> SupportTicket | None:
    if not ticket_id:
        return None
    if not _use_ddb():
        _ensure_file_loaded()
        return _mem_tickets.get(ticket_id)

    resp = get_identity_table().get_item(
        Key={"pk": f"TICKET#{ticket_id}"},
        ConsistentRead=True,
    )
    item = resp.get("Item")
    return _item_to_ticket(item) if item else None


def update_support_ticket(
    ticket_id: str,
    *,
    status: TicketStatus,
    resolution_note: str,
    resolved_by: str,
) -> SupportTicket:
    ticket = get_support_ticket(ticket_id)
    if ticket is None:
        raise LookupError("Support ticket not found.")
    if status not in ("OPEN", "IN_REVIEW", "RESOLVED", "CLOSED"):
        raise ValueError("Invalid ticket status.")

    now = _now_iso()
    note = resolution_note.strip()[:500]
    if not _use_ddb():
        ticket.status = status
        ticket.resolution_note = note
        ticket.resolved_by = resolved_by
        ticket.updated_at = now
        _persist_file()
        return ticket

    get_identity_table().update_item(
        Key={"pk": f"TICKET#{ticket_id}"},
        UpdateExpression=(
            "SET #status = :st, resolution_note = :note, "
            "resolved_by = :rb, updated_at = :upd"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":st": status,
            ":note": note,
            ":rb": resolved_by,
            ":upd": now,
        },
        ConditionExpression="attribute_exists(pk)",
    )
    ticket.status = status
    ticket.resolution_note = note
    ticket.resolved_by = resolved_by
    ticket.updated_at = now
    return ticket
