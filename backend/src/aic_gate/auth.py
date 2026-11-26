"""JWT authentication, bcrypt hashing, optional TOTP MFA, and FastAPI RBAC."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal

import bcrypt
import jwt
import pyotp
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from aic_gate.config import get_settings
from aic_gate.identity_store import (
    DEFAULT_LAB_ORG_ID,
    AdminTier,
    UserAccount,
    UserRole,
    get_organization,
    get_user,
    reset_identity_store,
    seed_default_lab,
    update_user_mfa,
)

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "aic-gate"

_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    username: str
    display_name: str
    role: UserRole
    department: str
    org_id: str = DEFAULT_LAB_ORG_ID
    mfa_enabled: bool = False
    admin_tier: AdminTier = "none"


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    if not password or len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode(
        "utf-8"
    )


def verify_password(password: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    if not password or not hashed:
        return False
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            hashed.encode("utf-8"),
        )
    except ValueError:
        return False


@lru_cache(maxsize=1)
def ensure_demo_users_seeded() -> bool:
    """Seed the default lab org & demo accounts once when enabled."""
    settings = get_settings()
    if not settings.demo_users_enabled:
        return False

    seed_default_lab(
        requester_password_hash=hash_password(settings.demo_requester_password),
        admin_password_hash=hash_password(settings.demo_admin_password),
        master_password_hash=hash_password(settings.demo_master_password),
    )
    return True


def clear_user_cache() -> None:
    """Reset cached seed flag and in-memory identity store (for tests)."""
    ensure_demo_users_seeded.cache_clear()
    reset_identity_store()


def account_to_authenticated_user(account: UserAccount) -> AuthenticatedUser:
    tier: AdminTier = account.admin_tier
    if account.role == "admin" and tier == "none":
        tier = "owner"
    elif account.role == "platform_admin" and tier == "none":
        tier = "master"
    return AuthenticatedUser(
        user_id=account.user_id,
        username=account.username,
        display_name=account.display_name,
        role=account.role,
        department=account.department,
        org_id=account.org_id,
        mfa_enabled=account.mfa_enabled,
        admin_tier=tier,
    )


def authenticate_account(username: str, password: str) -> UserAccount | None:
    """Validate credentials and return the UserAccount, enforcing ACTIVE status."""
    ensure_demo_users_seeded()
    normalized = username.strip().lower()
    if not normalized or not password:
        return None

    account = get_user(normalized)
    if account is None:
        return None

    if not verify_password(password, account.password_hash):
        return None

    if account.status == "PENDING_APPROVAL":
        raise PermissionError(
            "Account is pending organization administrator approval."
        )
    if account.status == "SUSPENDED":
        raise PermissionError("Account has been suspended by an administrator.")
    if account.status != "ACTIVE":
        raise PermissionError("Account is not active.")

    if account.role != "platform_admin":
        org = get_organization(account.org_id)
        if org is not None and org.status == "SUSPENDED":
            raise PermissionError(
                "Organization is currently suspended. Contact AIC-GATE support."
            )

    return account


def authenticate_user(username: str, password: str) -> AuthenticatedUser | None:
    """Validate credentials and return AuthenticatedUser or None."""
    try:
        account = authenticate_account(username, password)
    except PermissionError:
        return None
    return account_to_authenticated_user(account) if account else None


def create_access_token(user: AuthenticatedUser) -> tuple[str, int]:
    """Mint a signed HS256 access JWT and return (token, ttl_seconds)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    ttl_seconds = settings.jwt_ttl_minutes * 60
    expires_at = now + timedelta(seconds=ttl_seconds)

    payload = {
        "purpose": "access",
        "sub": user.user_id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "admin_tier": (
            user.admin_tier
            if user.admin_tier != "none"
            else (
                "master"
                if user.role == "platform_admin"
                else ("owner" if user.role == "admin" else "none")
            )
        ),
        "department": user.department,
        "org_id": user.org_id,
        "mfa_enabled": user.mfa_enabled,
        "iss": JWT_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }

    token = jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)
    return token, ttl_seconds


def decode_access_token(token: str) -> AuthenticatedUser:
    """Decode and validate an HS256 access JWT, returning AuthenticatedUser."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            options={"require": ["sub", "role", "exp", "iat", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid or expired authentication token.") from exc

    if payload.get("purpose", "access") != "access":
        raise ValueError("Token cannot be used for API access.")

    role = payload.get("role")
    if role not in ("requester", "admin", "platform_admin"):
        raise ValueError("Invalid role claim in authentication token.")

    user_id = str(payload.get("sub", "")).strip()
    username = str(payload.get("username", "")).strip()
    if not user_id or not username:
        raise ValueError("Missing identity claims in authentication token.")

    raw_tier = str(payload.get("admin_tier") or "")
    if raw_tier in ("none", "delegated", "owner", "master"):
        admin_tier: AdminTier = raw_tier  # type: ignore[assignment]
    elif role == "platform_admin":
        admin_tier = "master"
    elif role == "admin":
        admin_tier = "owner"
    else:
        admin_tier = "none"

    return AuthenticatedUser(
        user_id=user_id,
        username=username,
        display_name=str(payload.get("display_name") or username),
        role=role,
        department=str(payload.get("department") or "Unknown"),
        org_id=str(payload.get("org_id") or DEFAULT_LAB_ORG_ID),
        mfa_enabled=bool(payload.get("mfa_enabled", False)),
        admin_tier=admin_tier,
    )


def create_mfa_challenge_token(account: UserAccount) -> str:
    """Mint a short-lived single-purpose MFA challenge token (5 min)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "mfa_challenge",
        "sub": account.user_id,
        "username": account.username,
        "iss": JWT_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_mfa_challenge_token(token: str) -> str:
    """Validate an MFA challenge JWT and return the username."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            options={"require": ["sub", "username", "purpose", "exp", "iat", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid or expired MFA challenge token.") from exc

    if payload.get("purpose") != "mfa_challenge":
        raise ValueError("Invalid MFA challenge token.")

    username = str(payload.get("username", "")).strip().lower()
    if not username:
        raise ValueError("Invalid MFA challenge token.")
    return username


def begin_mfa_setup(username: str) -> tuple[str, str]:
    """Generate a pending TOTP secret and otpauth URI for enrollment."""
    ensure_demo_users_seeded()
    account = get_user(username)
    if account is None:
        raise LookupError("User not found.")

    secret = pyotp.random_base32()
    update_user_mfa(
        account.username,
        mfa_enabled=account.mfa_enabled,
        mfa_secret=account.mfa_secret,
        mfa_pending_secret=secret,
    )
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=account.email,
        issuer_name="AIC-GATE",
    )
    return secret, uri


def confirm_mfa_enable(username: str, otp_code: str) -> UserAccount:
    """Verify the enrollment TOTP code and activate MFA on the user account."""
    ensure_demo_users_seeded()
    account = get_user(username)
    if account is None:
        raise LookupError("User not found.")
    if not account.mfa_pending_secret:
        raise ValueError("No pending MFA setup found. Start MFA setup first.")

    totp = pyotp.TOTP(account.mfa_pending_secret)
    if not totp.verify(otp_code.strip(), valid_window=1):
        raise ValueError("Invalid 6-digit authenticator code.")

    return update_user_mfa(
        account.username,
        mfa_enabled=True,
        mfa_secret=account.mfa_pending_secret,
        mfa_pending_secret=None,
    )


def verify_user_otp(account: UserAccount, otp_code: str) -> bool:
    """Verify a login TOTP code against the user's enrolled secret."""
    if not account.mfa_enabled or not account.mfa_secret:
        return False
    return pyotp.TOTP(account.mfa_secret).verify(
        otp_code.strip(),
        valid_window=1,
    )


def disable_user_mfa(username: str, password: str) -> UserAccount:
    """Disable optional MFA after verifying the user's current password."""
    ensure_demo_users_seeded()
    account = get_user(username)
    if account is None:
        raise LookupError("User not found.")
    if not verify_password(password, account.password_hash):
        raise PermissionError("Invalid password.")

    return update_user_mfa(
        account.username,
        mfa_enabled=False,
        mfa_secret=None,
        mfa_pending_secret=None,
    )


def admin_reset_user_mfa(username: str) -> UserAccount:
    """Break-glass MFA reset performed by Platform Master Admin."""
    ensure_demo_users_seeded()
    account = get_user(username)
    if account is None:
        raise LookupError("User not found.")
    return update_user_mfa(
        account.username,
        mfa_enabled=False,
        mfa_secret=None,
        mfa_pending_secret=None,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> AuthenticatedUser:
    """FastAPI dependency requiring a valid Bearer access JWT."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        return decode_access_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def require_admin(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """FastAPI dependency requiring an organization admin (owner or delegated)."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return user


def require_org_owner(
    user: AuthenticatedUser = Depends(require_admin),
) -> AuthenticatedUser:
    """FastAPI dependency requiring the primary Organization Owner."""
    effective_tier = "owner" if user.admin_tier == "none" else user.admin_tier
    if effective_tier != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization Owner privileges required",
        )
    return user


def require_platform_admin(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """FastAPI dependency requiring AIC-GATE Platform Master Admin."""
    if user.role != "platform_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform Master Admin privileges required",
        )
    return user
