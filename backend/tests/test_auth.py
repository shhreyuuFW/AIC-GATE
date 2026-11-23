"""Unit tests for authentication, password hashing, and JWT validation."""

from datetime import datetime, timedelta, timezone

import jwt
import pytest

from aic_gate.auth import (
    JWT_ALGORITHM,
    JWT_ISSUER,
    AuthenticatedUser,
    authenticate_user,
    clear_user_cache,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from aic_gate.config import get_settings


@pytest.fixture(autouse=True)
def reset_caches(monkeypatch):
    monkeypatch.delenv("AIC_GATE_ENV", raising=False)
    monkeypatch.delenv("AIC_GATE_JWT_SECRET", raising=False)
    monkeypatch.delenv("AIC_GATE_DEMO_USERS_ENABLED", raising=False)
    get_settings.cache_clear()
    clear_user_cache()
    yield
    get_settings.cache_clear()
    clear_user_cache()


def test_password_hash_and_verify_roundtrip():
    hashed = hash_password("strong-pass-123")
    assert hashed != "strong-pass-123"
    assert verify_password("strong-pass-123", hashed) is True
    assert verify_password("wrong-pass", hashed) is False
    assert verify_password("", hashed) is False
    assert verify_password("strong-pass-123", "not-a-bcrypt-hash") is False


def test_authenticate_demo_users():
    operator = authenticate_user("operator", "operator-demo-pass")
    assert operator is not None
    assert operator.user_id == "usr-operator-01"
    assert operator.role == "requester"

    commander = authenticate_user("COMMANDER", "commander-demo-pass")
    assert commander is not None
    assert commander.user_id == "usr-admin-01"
    assert commander.role == "admin"

    assert authenticate_user("operator", "wrong") is None
    assert authenticate_user("unknown", "operator-demo-pass") is None


def test_demo_users_disabled_when_flag_off(monkeypatch):
    monkeypatch.setenv("AIC_GATE_DEMO_USERS_ENABLED", "0")
    get_settings.cache_clear()
    clear_user_cache()

    assert authenticate_user("operator", "operator-demo-pass") is None


def test_production_requires_long_jwt_secret(monkeypatch):
    monkeypatch.setenv("AIC_GATE_ENV", "production")
    monkeypatch.setenv("AIC_GATE_JWT_SECRET", "too-short")
    get_settings.cache_clear()

    with pytest.raises(RuntimeError, match="32 characters"):
        get_settings()


def test_jwt_create_and_decode_roundtrip():
    user = AuthenticatedUser(
        user_id="usr-1",
        username="operator",
        display_name="Field Operator",
        role="requester",
        department="Cloud Ops",
    )
    token, ttl = create_access_token(user)
    assert ttl == 3600

    decoded = decode_access_token(token)
    assert decoded == user


def test_jwt_rejects_expired_and_tampered_tokens():
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expired_payload = {
        "sub": "usr-1",
        "username": "operator",
        "role": "requester",
        "iss": JWT_ISSUER,
        "iat": int((now - timedelta(hours=2)).timestamp()),
        "exp": int((now - timedelta(minutes=1)).timestamp()),
    }
    expired_token = jwt.encode(
        expired_payload,
        settings.jwt_secret,
        algorithm=JWT_ALGORITHM,
    )
    with pytest.raises(ValueError):
        decode_access_token(expired_token)

    with pytest.raises(ValueError):
        decode_access_token("not.a.jwt")
