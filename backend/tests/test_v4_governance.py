from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from aic_gate.audit import clear_audit_events
from aic_gate.auth import clear_user_cache
from aic_gate.config import get_settings
from aic_gate.identity_store import (
    DEFAULT_LAB_INVITE_CODE,
    create_notification,
    find_organization_by_invite_code,
    get_user,
)
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


def _login(username: str, password: str) -> str:
    res = client.post(
        "/auth/login",
        json={"username": username, "password": password},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_invite_lookup_and_non_reusable_rotation():
    lookup = client.get(f"/auth/invite/{DEFAULT_LAB_INVITE_CODE}")
    assert lookup.status_code == 200
    assert lookup.json() == {
        "org_name": "AIC-GATE Security Lab",
        "allowed_domain": "aicgate.local",
    }

    bad = client.get("/auth/invite/DOES-NOT-EXIST")
    assert bad.status_code == 404

    owner_token = _login("commander", "commander-demo-pass")
    rot1 = client.post("/admin/org/rotate-invite", headers=_headers(owner_token))
    assert rot1.status_code == 200
    code1 = rot1.json()["invite_code"]
    assert code1 != DEFAULT_LAB_INVITE_CODE

    # Old code no longer resolves to the org
    assert find_organization_by_invite_code(DEFAULT_LAB_INVITE_CODE) is None

    # Register another org and verify codes never collide
    reg = client.post(
        "/auth/register-org",
        json={
            "org_name": "Delta Cloud",
            "allowed_domain": "delta.io",
            "admin_username": "delta.owner",
            "admin_email": "owner@delta.io",
            "admin_display_name": "Delta Owner",
            "password": "delta-password-1",
        },
    )
    assert reg.status_code == 201
    assert reg.json()["organization"]["invite_code"] not in {
        DEFAULT_LAB_INVITE_CODE,
        code1,
    }


def test_org_owner_vs_delegated_admin_separation_of_duties():
    owner_token = _login("commander", "commander-demo-pass")

    # Promote operator to delegated org_admin
    promote = client.patch(
        "/admin/users/operator",
        headers=_headers(owner_token),
        json={"admin_action": "PROMOTE_DELEGATED"},
    )
    assert promote.status_code == 200
    assert promote.json()["role"] == "admin"
    assert promote.json()["admin_tier"] == "delegated"

    # Re-login as promoted delegated admin
    delegated_token = _login("operator", "operator-demo-pass")

    # Delegated admin can list org users & manage custom roles
    assert client.get("/admin/users", headers=_headers(delegated_token)).status_code == 200

    # Delegated admin CANNOT rename org, rotate invite, or demote owner
    rename_denied = client.patch(
        "/admin/org",
        headers=_headers(delegated_token),
        json={"org_name": "Hijacked Org"},
    )
    assert rename_denied.status_code == 403

    rotate_denied = client.post(
        "/admin/org/rotate-invite",
        headers=_headers(delegated_token),
    )
    assert rotate_denied.status_code == 403

    demote_owner_denied = client.patch(
        "/admin/users/commander",
        headers=_headers(delegated_token),
        json={"admin_action": "DEMOTE_REQUESTER"},
    )
    assert demote_owner_denied.status_code == 403

    # Owner CAN rename org and demote delegated admin
    rename_ok = client.patch(
        "/admin/org",
        headers=_headers(owner_token),
        json={"org_name": "AIC-GATE Core Lab"},
    )
    assert rename_ok.status_code == 200
    assert rename_ok.json()["org_name"] == "AIC-GATE Core Lab"

    demote_ok = client.patch(
        "/admin/users/operator",
        headers=_headers(owner_token),
        json={"admin_action": "DEMOTE_REQUESTER"},
    )
    assert demote_ok.status_code == 200
    assert demote_ok.json()["role"] == "requester"


def test_custom_roles_crud_and_mass_assign():
    owner_token = _login("commander", "commander-demo-pass")

    created = client.post(
        "/admin/org-roles",
        headers=_headers(owner_token),
        json={
            "name": "Incident Responder",
            "description": "Emergency read-only production triage",
            "color": "red",
        },
    )
    assert created.status_code == 201
    role_id = created.json()["role_id"]

    # Mass assign to operator and commander
    assign = client.post(
        f"/admin/org-roles/{role_id}/assign",
        headers=_headers(owner_token),
        json={"usernames": ["operator"]},
    )
    assert assign.status_code == 200
    assert assign.json()["updated"][0]["effective_role"] == "Incident Responder"

    # Update role name
    upd = client.patch(
        f"/admin/org-roles/{role_id}",
        headers=_headers(owner_token),
        json={"name": "SOC Responder", "color": "amber"},
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "SOC Responder"

    # Delete role clears custom role from assigned member
    deleted = client.delete(
        f"/admin/org-roles/{role_id}",
        headers=_headers(owner_token),
    )
    assert deleted.status_code == 200
    op = get_user("operator")
    assert op is not None
    assert op.custom_role_id is None


def test_user_profile_updates_and_role_isolation():
    op_token = _login("operator", "operator-demo-pass")

    # Valid profile update (preset & PNG data URI)
    ok = client.patch(
        "/auth/profile",
        headers=_headers(op_token),
        json={
            "display_name": "Field Operator Prime",
            "bio": "Handling S3 and CloudWatch incident triage.",
            "avatar": "preset:radar",
        },
    )
    assert ok.status_code == 200
    user_payload = ok.json()["user"]
    assert user_payload["display_name"] == "Field Operator Prime"
    assert user_payload["avatar"] == "preset:radar"
    assert user_payload["role"] == "requester"

    # Reject unsafe SVG or external URL avatars
    bad_svg = client.patch(
        "/auth/profile",
        headers=_headers(op_token),
        json={"avatar": "data:image/svg+xml;base64,PHN2Zz4="},
    )
    assert bad_svg.status_code == 400

    bad_url = client.patch(
        "/auth/profile",
        headers=_headers(op_token),
        json={"avatar": "https://evil.example/a.png"},
    )
    assert bad_url.status_code == 400


def test_notifications_away_summary_and_mark_read():
    op_token = _login("operator", "operator-demo-pass")
    cmd_token = _login("commander", "commander-demo-pass")

    # Operator submits request -> notifies commander
    with patch(
        "aic_gate.main.submit_access_request_record",
        return_value={
            "request_id": "req-notif-01",
            "requester_id": "usr-operator-01",
            "requester_username": "operator",
            "requester_display_name": "Field Operator",
            "org_id": "org-aicgate-lab",
            "service": "s3",
            "bucket": "cloudsec.proj.aicgate",
            "prefix": "logs/",
            "actions": ["s3:GetObject"],
            "duration_minutes": 15,
            "reason": "Need logs",
            "risk_level": "LOW",
            "status": "PENDING",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_at": None,
            "reviewed_by": None,
        },
    ):
        req_res = client.post(
            "/requests",
            headers=_headers(op_token),
            json={
                "resource_id": "s3-app-logs",
                "actions": ["s3:GetObject"],
                "duration_minutes": 15,
                "reason": "Need logs",
            },
        )
        assert req_res.status_code == 201
        assert req_res.json()["requester_username"] == "operator"

    notifs = client.get("/notifications", headers=_headers(cmd_token))
    assert notifs.status_code == 200
    body = notifs.json()
    assert body["unread_count"] >= 1
    assert body["away_summary"]["variant"] == "live"

    # Inject an older unread notification before last_login_at -> triggers "away"
    cmd_user = get_user("commander")
    assert cmd_user is not None
    old_n = create_notification(
        user_id=cmd_user.user_id,
        org_id=cmd_user.org_id,
        kind="MEMBER_SIGNUP",
        title="Older Signup",
        message="Pending while away",
    )
    old_n.created_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    away_res = client.get("/notifications", headers=_headers(cmd_token)).json()
    assert away_res["away_summary"]["variant"] == "away"

    marked = client.post(
        "/notifications/read",
        headers=_headers(cmd_token),
        json={"mark_all": True},
    )
    assert marked.status_code == 200
    assert marked.json()["marked"] >= 2
    assert (
        client.get("/notifications", headers=_headers(cmd_token)).json()["unread_count"]
        == 0
    )


def test_multi_service_scope_tester_enforcement():
    op_token = _login("operator", "operator-demo-pass")
    presets = client.get("/scope-tester/presets", headers=_headers(op_token))
    assert presets.status_code == 200
    assert "dynamodb" in presets.json()["presets"]

    now = datetime.now(timezone.utc)
    cw_session = SimpleNamespace(
        session_id="sess-cw-01",
        request_id="req-cw-01",
        requester_id="usr-operator-01",
        org_id="org-aicgate-lab",
        service="cloudwatch_logs",
        resource_id="cw-api-logs",
        bucket="/aic-gate/app",
        prefix="/aic-gate/app",
        actions=["logs:GetLogEvents"],
        created_at=now,
        expires_at=now + timedelta(minutes=20),
        status="ACTIVE",
    )

    with patch("aic_gate.main.get_session", return_value=cw_session):
        ok = client.post(
            "/sessions/sess-cw-01/test",
            headers=_headers(op_token),
            json={"service": "cloudwatch_logs", "query": "/aic-gate/app"},
        )
        assert ok.status_code == 200
        assert ok.json()["simulated"] is True
        assert len(ok.json()["events"]) > 0

        # Cross-service denied
        cross = client.post(
            "/sessions/sess-cw-01/test",
            headers=_headers(op_token),
            json={"service": "dynamodb", "query": "AICGateSession"},
        )
        assert cross.status_code == 403

        # Out-of-scope log group denied
        oob = client.post(
            "/sessions/sess-cw-01/test",
            headers=_headers(op_token),
            json={"service": "cloudwatch_logs", "query": "/aws/security/audit"},
        )
        assert oob.status_code == 403


def test_master_admin_portal_tickets_and_tenant_isolation():
    cmd_token = _login("commander", "commander-demo-pass")
    master_token = _login("master", "master-demo-pass")

    # Zero-trust tenant boundary: Master Admin CANNOT access tenant STS/requests
    assert (
        client.get("/admin/requests", headers=_headers(master_token)).status_code
        == 403
    )
    assert client.get("/sessions", headers=_headers(master_token)).status_code == 403

    # Regular org admin cannot access Master API
    assert (
        client.get("/master-api/orgs", headers=_headers(cmd_token)).status_code == 403
    )

    # Org admin creates rename ticket -> Master resolves with auto-rename
    tkt = client.post(
        "/admin/tickets",
        headers=_headers(cmd_token),
        json={
            "category": "ORG_RENAME",
            "subject": "Rename Lab Organization",
            "description": "Update tenant display name for presentation.",
            "requested_value": "AIC-GATE Production Lab",
        },
    )
    assert tkt.status_code == 201
    ticket_id = tkt.json()["ticket_id"]

    orgs = client.get("/master-api/orgs", headers=_headers(master_token))
    assert orgs.status_code == 200
    assert any(o["org_id"] == "org-aicgate-lab" for o in orgs.json()["organizations"])

    resolve = client.patch(
        f"/master-api/tickets/{ticket_id}",
        headers=_headers(master_token),
        json={
            "status": "RESOLVED",
            "resolution_note": "Approved and applied rename.",
            "apply_org_rename": True,
        },
    )
    assert resolve.status_code == 200
    assert resolve.json()["applied_rename"] is True

    org_after = client.get("/admin/org", headers=_headers(cmd_token))
    assert org_after.status_code == 200
    assert org_after.json()["org_name"] == "AIC-GATE Production Lab"


def test_file_backend_persists_across_store_reset(tmp_path, monkeypatch):
    store_file = tmp_path / "identity.json"
    monkeypatch.setenv("AIC_GATE_IDENTITY_BACKEND", "file")
    monkeypatch.setenv("AIC_GATE_IDENTITY_FILE", str(store_file))
    get_settings.cache_clear()
    clear_user_cache()

    reg = client.post(
        "/auth/register-org",
        json={
            "org_name": "Endfield Industries",
            "allowed_domain": "endfield.talos",
            "admin_username": "endmin",
            "admin_email": "endmin@endfield.talos",
            "admin_display_name": "Endministrator",
            "admin_department": "Protocol Command",
            "password": "endmin-password-1",
        },
    )
    assert reg.status_code == 201
    token = reg.json()["access_token"]
    invite = reg.json()["organization"]["invite_code"]

    role_res = client.post(
        "/admin/org-roles",
        headers=_headers(token),
        json={
            "name": "Supervisor",
            "description": "Protocol operations supervisor",
            "color": "green",
        },
    )
    assert role_res.status_code == 201

    prof = client.patch(
        "/auth/profile",
        headers=_headers(token),
        json={
            "bio": "Talos-II command clearance.",
            "avatar": "data:image/png;base64,iVBORw0KGgo=",
        },
    )
    assert prof.status_code == 200
    assert store_file.is_file()

    # Simulate full backend restart by clearing in-memory caches
    clear_user_cache()

    relogin = _login("endmin", "endmin-password-1")
    me = client.get("/auth/me", headers=_headers(relogin))
    assert me.status_code == 200
    assert me.json()["org_name"] == "Endfield Industries"
    assert me.json()["bio"] == "Talos-II command clearance."
    assert me.json()["avatar"] == "data:image/png;base64,iVBORw0KGgo="

    lookup = client.get(f"/auth/invite/{invite}")
    assert lookup.status_code == 200
    assert lookup.json()["org_name"] == "Endfield Industries"
