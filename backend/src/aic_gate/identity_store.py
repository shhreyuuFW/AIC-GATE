"""Multi-tenant organization and user account store (in-memory or DynamoDB)."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from functools import lru_cache
import secrets
from typing import Literal
from uuid import uuid4

from botocore.exceptions import ClientError

from aic_gate.config import create_boto3_session, get_settings

UserRole = Literal["requester", "admin"]
UserStatus = Literal["ACTIVE", "PENDING_APPROVAL", "REJECTED"]

DEFAULT_LAB_ORG_ID = "org-aicgate-lab"
DEFAULT_LAB_INVITE_CODE = "LAB-AICGATE-2026"


@dataclass
class Organization:
    org_id: str
    org_name: str
    allowed_domain: str
    invite_code: str
    created_at: str
    created_by: str


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


_mem_orgs: dict[str, Organization] = {}
_mem_users: dict[str, UserAccount] = {}


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
    )


def _user_to_item(user: UserAccount) -> dict:
    item = asdict(user)
    item["pk"] = f"USER#{user.username}"
    item["entity_type"] = "USER"
    return item


def _item_to_user(item: dict) -> UserAccount:
    return UserAccount(
        user_id=item["user_id"],
        org_id=item["org_id"],
        username=item["username"],
        email=item["email"],
        display_name=item["display_name"],
        department=item["department"],
        role=item["role"],
        status=item["status"],
        password_hash=item["password_hash"],
        mfa_enabled=bool(item.get("mfa_enabled", False)),
        mfa_secret=item.get("mfa_secret"),
        mfa_pending_secret=item.get("mfa_pending_secret"),
        created_at=item.get("created_at", ""),
    )


def reset_identity_store() -> None:
    """Clear in-memory organizations and users (for test isolation)."""
    _mem_orgs.clear()
    _mem_users.clear()


def seed_default_lab(
    *,
    requester_password_hash: str,
    admin_password_hash: str,
) -> None:
    """Idempotently seed the default AIC-GATE lab org and demo accounts."""
    now = _now_iso()
    if get_organization(DEFAULT_LAB_ORG_ID) is None:
        lab_org = Organization(
            org_id=DEFAULT_LAB_ORG_ID,
            org_name="AIC-GATE Security Lab",
            allowed_domain="aicgate.local",
            invite_code=DEFAULT_LAB_INVITE_CODE,
            created_at=now,
            created_by="usr-admin-01",
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
            )
        )


def _save_org(org: Organization, *, must_not_exist: bool = False) -> None:
    if not _use_ddb():
        if must_not_exist and org.org_id in _mem_orgs:
            raise ValueError("Organization already exists.")
        _mem_orgs[org.org_id] = org
        return

    kwargs = {"Item": _org_to_item(org)}
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
        if must_not_exist and user.username in _mem_users:
            raise ValueError("Username is already taken.")
        _mem_users[user.username] = user
        return

    kwargs = {"Item": _user_to_item(user)}
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


def get_organization(org_id: str) -> Organization | None:
    if not _use_ddb():
        return _mem_orgs.get(org_id)

    resp = get_identity_table().get_item(
        Key={"pk": f"ORG#{org_id}"},
        ConsistentRead=True,
    )
    item = resp.get("Item")
    return _item_to_org(item) if item else None


def find_organization_by_invite_code(invite_code: str) -> Organization | None:
    code = invite_code.strip().upper()
    if not code:
        return None

    if not _use_ddb():
        for org in _mem_orgs.values():
            if org.invite_code.upper() == code:
                return org
        return None

    table = get_identity_table()
    scan_args: dict = {
        "FilterExpression": "entity_type = :et AND invite_code = :code",
        "ExpressionAttributeValues": {":et": "ORG", ":code": code},
    }
    while True:
        resp = table.scan(**scan_args)
        items = resp.get("Items", [])
        if items:
            return _item_to_org(items[0])
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            return None
        scan_args["ExclusiveStartKey"] = last_key


def rotate_org_invite_code(org_id: str) -> Organization:
    org = get_organization(org_id)
    if org is None:
        raise LookupError("Organization not found.")

    new_code = _generate_invite_code()
    if not _use_ddb():
        org.invite_code = new_code
        return org

    get_identity_table().update_item(
        Key={"pk": f"ORG#{org_id}"},
        UpdateExpression="SET invite_code = :code",
        ExpressionAttributeValues={":code": new_code},
        ConditionExpression="attribute_exists(pk)",
    )
    org.invite_code = new_code
    return org


def get_user(username: str) -> UserAccount | None:
    normalized = username.strip().lower()
    if not normalized:
        return None

    if not _use_ddb():
        return _mem_users.get(normalized)

    resp = get_identity_table().get_item(
        Key={"pk": f"USER#{normalized}"},
        ConsistentRead=True,
    )
    item = resp.get("Item")
    return _item_to_user(item) if item else None


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

    org = Organization(
        org_id=org_id,
        org_name=clean_org,
        allowed_domain=clean_domain,
        invite_code=_generate_invite_code(),
        created_at=now,
        created_by=admin_id,
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
    )
    _save_user(user, must_not_exist=True)
    return user


def list_org_users(org_id: str) -> list[UserAccount]:
    if not _use_ddb():
        users = [u for u in _mem_users.values() if u.org_id == org_id]
        users.sort(key=lambda u: u.created_at, reverse=True)
        return users

    table = get_identity_table()
    items: list[dict] = []
    scan_args: dict = {
        "FilterExpression": "entity_type = :et AND org_id = :org",
        "ExpressionAttributeValues": {":et": "USER", ":org": org_id},
    }
    while True:
        resp = table.scan(**scan_args)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_args["ExclusiveStartKey"] = last_key

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
