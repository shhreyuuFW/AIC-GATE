"""Unit tests for multi-tenant orgs, member approval, and optional TOTP MFA."""

from fastapi.testclient import TestClient
import pyotp
import pytest

from aic_gate.audit import clear_audit_events
from aic_gate.auth import clear_user_cache
from aic_gate.config import get_settings
from aic_gate.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_state(monkeypatch):
    monkeypatch.setenv("AIC_GATE_IDENTITY_BACKEND", "memory")
    get_settings.cache_clear()
    clear_user_cache()
    clear_audit_events()
    yield
    get_settings.cache_clear()
    clear_user_cache()
    clear_audit_events()


def test_org_registration_signup_approval_and_tenant_isolation():
    # 1. Register a brand-new organization
    reg_resp = client.post(
        "/auth/register-org",
        json={
            "org_name": "Acme Cloud Sec",
            "allowed_domain": "acme.io",
            "admin_username": "alice_admin",
            "admin_email": "alice@acme.io",
            "admin_display_name": "Alice Admin",
            "password": "strong-admin-password",
        },
    )
    assert reg_resp.status_code == 201
    reg_body = reg_resp.json()
    admin_token = reg_body["access_token"]
    invite_code = reg_body["organization"]["invite_code"]
    org_id = reg_body["organization"]["org_id"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2. Employee signup with wrong domain is rejected
    bad_domain = client.post(
        "/auth/signup",
        json={
            "invite_code": invite_code,
            "username": "bob_dev",
            "email": "bob@gmail.com",
            "display_name": "Bob Dev",
            "password": "bob-password-123",
        },
    )
    assert bad_domain.status_code == 400

    # 3. Employee signup with valid domain creates PENDING_APPROVAL account
    signup = client.post(
        "/auth/signup",
        json={
            "invite_code": invite_code,
            "username": "bob_dev",
            "email": "bob@acme.io",
            "display_name": "Bob Dev",
            "department": "Platform",
            "password": "bob-password-123",
        },
    )
    assert signup.status_code == 201
    assert signup.json()["user"]["status"] == "PENDING_APPROVAL"
    assert "password_hash" not in signup.json()["user"]

    # 4. Pending employee cannot log in yet
    blocked_login = client.post(
        "/auth/login",
        json={"username": "bob_dev", "password": "bob-password-123"},
    )
    assert blocked_login.status_code == 403

    # 5. Lab admin (different org) cannot list or approve Acme's users
    lab_login = client.post(
        "/auth/login",
        json={"username": "commander", "password": "commander-demo-pass"},
    )
    lab_admin_headers = {
        "Authorization": f"Bearer {lab_login.json()['access_token']}"
    }
    lab_users = client.get("/admin/users", headers=lab_admin_headers).json()["users"]
    assert all(u["org_id"] != org_id for u in lab_users)
    cross_review = client.post(
        "/admin/users/bob_dev/review",
        json={"decision": "ACTIVE"},
        headers=lab_admin_headers,
    )
    assert cross_review.status_code == 404

    # 6. Acme admin approves Bob
    approve = client.post(
        "/admin/users/bob_dev/review",
        json={"decision": "ACTIVE"},
        headers=admin_headers,
    )
    assert approve.status_code == 200
    assert approve.json()["status"] == "ACTIVE"

    # 7. Bob can now log in (without MFA since MFA is optional)
    bob_login = client.post(
        "/auth/login",
        json={"username": "bob_dev", "password": "bob-password-123"},
    )
    assert bob_login.status_code == 200
    assert bob_login.json()["mfa_required"] is False
    assert bob_login.json()["user"]["org_id"] == org_id


def test_optional_totp_mfa_enrollment_login_and_disable():
    # Login as operator without MFA
    login_resp = client.post(
        "/auth/login",
        json={"username": "operator", "password": "operator-demo-pass"},
    )
    assert login_resp.status_code == 200
    assert login_resp.json()["mfa_required"] is False
    headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

    # Start MFA setup
    setup = client.post("/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert "otpauth://totp/" in setup.json()["otpauth_uri"]

    # Wrong OTP fails
    bad_enable = client.post(
        "/auth/mfa/enable",
        json={"otp_code": "000000"},
        headers=headers,
    )
    assert bad_enable.status_code == 400

    # Valid OTP enables MFA
    valid_code = pyotp.TOTP(secret).now()
    enable = client.post(
        "/auth/mfa/enable",
        json={"otp_code": valid_code},
        headers=headers,
    )
    assert enable.status_code == 200
    assert enable.json()["mfa_enabled"] is True

    # Next login requires MFA challenge
    mfa_login = client.post(
        "/auth/login",
        json={"username": "operator", "password": "operator-demo-pass"},
    )
    assert mfa_login.status_code == 200
    assert mfa_login.json()["mfa_required"] is True
    challenge_token = mfa_login.json()["mfa_challenge_token"]

    # Challenge token CANNOT be used directly on API endpoints
    assert (
        client.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {challenge_token}"},
        ).status_code
        == 401
    )

    # Verify TOTP completes login
    verify = client.post(
        "/auth/mfa/verify",
        json={
            "mfa_challenge_token": challenge_token,
            "otp_code": pyotp.TOTP(secret).now(),
        },
    )
    assert verify.status_code == 200
    new_headers = {"Authorization": f"Bearer {verify.json()['access_token']}"}
    assert verify.json()["user"]["mfa_enabled"] is True

    # Disable MFA requires password
    assert (
        client.post(
            "/auth/mfa/disable",
            json={"password": "wrong"},
            headers=new_headers,
        ).status_code
        == 403
    )
    disabled = client.post(
        "/auth/mfa/disable",
        json={"password": "operator-demo-pass"},
        headers=new_headers,
    )
    assert disabled.status_code == 200
    assert disabled.json()["mfa_enabled"] is False
