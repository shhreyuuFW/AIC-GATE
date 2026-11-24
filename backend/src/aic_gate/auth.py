"""JWT authentication, bcrypt password hashing, and FastAPI RBAC dependencies."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from aic_gate.config import get_settings

UserRole = Literal["requester", "admin"]
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


@dataclass(frozen=True)
class _UserRecord:
    user: AuthenticatedUser
    password_hash: str


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    if not password:
        raise ValueError("Password must not be empty.")
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
def _get_demo_users() -> dict[str, _UserRecord]:
    settings = get_settings()
    if not settings.demo_users_enabled:
        return {}

    operator = AuthenticatedUser(
        user_id="usr-operator-01",
        username="operator",
        display_name="Field Operator",
        role="requester",
        department="Cloud Operations",
    )
    commander = AuthenticatedUser(
        user_id="usr-admin-01",
        username="commander",
        display_name="Security Commander",
        role="admin",
        department="Identity Governance",
    )

    return {
        operator.username: _UserRecord(
            user=operator,
            password_hash=hash_password(settings.demo_requester_password),
        ),
        commander.username: _UserRecord(
            user=commander,
            password_hash=hash_password(settings.demo_admin_password),
        ),
    }


def clear_user_cache() -> None:
    """Clear the cached user registry (for tests after env overrides)."""
    _get_demo_users.cache_clear()


def authenticate_user(username: str, password: str) -> AuthenticatedUser | None:
    """Validate credentials and return the authenticated user or None."""
    normalized = username.strip().lower()
    if not normalized or not password:
        return None

    record = _get_demo_users().get(normalized)
    if record is None:
        return None

    if not verify_password(password, record.password_hash):
        return None

    return record.user


def create_access_token(user: AuthenticatedUser) -> tuple[str, int]:
    """Mint a signed HS256 JWT for an authenticated user and return (token, ttl_seconds)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    ttl_seconds = settings.jwt_ttl_minutes * 60
    expires_at = now + timedelta(seconds=ttl_seconds)

    payload = {
        "sub": user.user_id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "department": user.department,
        "iss": JWT_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }

    token = jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)
    return token, ttl_seconds


def decode_access_token(token: str) -> AuthenticatedUser:
    """Decode and validate an HS256 JWT, returning the AuthenticatedUser."""
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

    role = payload.get("role")
    if role not in ("requester", "admin"):
        raise ValueError("Invalid role claim in authentication token.")

    user_id = str(payload.get("sub", "")).strip()
    username = str(payload.get("username", "")).strip()
    if not user_id or not username:
        raise ValueError("Missing identity claims in authentication token.")

    return AuthenticatedUser(
        user_id=user_id,
        username=username,
        display_name=str(payload.get("display_name") or username),
        role=role,
        department=str(payload.get("department") or "Unknown"),
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> AuthenticatedUser:
    """FastAPI dependency requiring a valid Bearer JWT."""
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
    """FastAPI dependency requiring an authenticated admin user."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return user
