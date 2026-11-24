
from datetime import datetime, timedelta, timezone
import json
from unittest.mock import MagicMock, patch

import pytest

from aic_gate.session import AccessSession
from aic_gate.sts_client import (
    assume_jit_role,
    build_session_policy,
    preview_session_policy,
)


def make_session(
    *,
    prefix="logs/",
    actions=None,
    status="ACTIVE",
    expires_in_minutes=30,
):
    now = datetime.now(timezone.utc)

    return AccessSession(
        session_id="test-session-12345678",
        bucket="cloudsec.proj.aicgate",
        prefix=prefix,
        actions=actions or ["s3:GetObject", "s3:ListBucket"],
        created_at=now,
        expires_at=now + timedelta(minutes=expires_in_minutes),
        status=status,
    )


def test_get_object_policy_is_scoped_to_prefix():
    policy = build_session_policy(
        make_session(actions=["s3:GetObject"])
    )

    statement = policy["Statement"][0]

    assert statement["Action"] == "s3:GetObject"
    assert statement["Resource"] == (
        "arn:aws:s3:::cloudsec.proj.aicgate/logs/*"
    )


def test_list_bucket_policy_restricts_prefix():
    policy = build_session_policy(
        make_session(actions=["s3:ListBucket"])
    )

    statement = policy["Statement"][0]

    assert statement["Action"] == "s3:ListBucket"
    assert statement["Condition"]["StringLike"]["s3:prefix"] == [
        "logs",
        "logs/*",
    ]


def test_combined_actions_create_two_statements():
    policy = build_session_policy(make_session())

    assert len(policy["Statement"]) == 2


@pytest.mark.parametrize(
    "prefix",
    ["", "../secret", "logs/../secret", "logs//secret", "*", "logs*", "logs/?", "."],
)
def test_invalid_prefix_is_rejected(prefix):
    with pytest.raises(ValueError):
        build_session_policy(make_session(prefix=prefix))


def test_preview_session_policy_matches_runtime_policy():
    preview = preview_session_policy(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject", "s3:ListBucket"],
    )
    runtime = build_session_policy(make_session())
    assert preview == runtime


def test_preview_session_policy_rejects_wildcard_prefix():
    with pytest.raises(ValueError):
        preview_session_policy(
            bucket="cloudsec.proj.aicgate",
            prefix="logs*",
            actions=["s3:GetObject"],
        )


@pytest.mark.parametrize("status", ["EXPIRED", "REVOKED"])
def test_inactive_session_is_rejected(status):
    with pytest.raises(ValueError):
        build_session_policy(make_session(status=status))


def test_unsupported_action_is_rejected():
    with pytest.raises(ValueError):
        build_session_policy(
            make_session(actions=["s3:DeleteObject"])
        )


def test_duplicate_actions_are_rejected():
    with pytest.raises(ValueError):
        build_session_policy(
            make_session(actions=["s3:GetObject", "s3:GetObject"])
        )


def test_assume_jit_role_calls_sts_with_scoped_policy():
    session = make_session()
    expiry = datetime.now(timezone.utc) + timedelta(minutes=30)
    mock_sts = MagicMock()
    mock_sts.assume_role.return_value = {
        "Credentials": {
            "AccessKeyId": "ASIA_TEST",
            "SecretAccessKey": "SECRET_TEST",
            "SessionToken": "TOKEN_TEST",
            "Expiration": expiry,
        }
    }

    with patch("aic_gate.sts_client.get_sts_client", return_value=mock_sts):
        creds = assume_jit_role(session, duration_seconds=1800)

    assert creds == {
        "access_key_id": "ASIA_TEST",
        "secret_access_key": "SECRET_TEST",
        "session_token": "TOKEN_TEST",
        "expires_at": expiry,
    }
    mock_sts.assume_role.assert_called_once()
    kwargs = mock_sts.assume_role.call_args.kwargs
    assert kwargs["RoleArn"].endswith(":role/AICGateJITRole")
    assert kwargs["RoleSessionName"] == "aic-gate-test-ses"
    assert kwargs["DurationSeconds"] == 1800
    parsed_policy = json.loads(kwargs["Policy"])
    assert len(parsed_policy["Statement"]) == 2


@pytest.mark.parametrize("duration", [899, 3601, True, False])
def test_assume_jit_role_rejects_invalid_duration(duration):
    with pytest.raises(ValueError, match="900 and 3600"):
        assume_jit_role(make_session(), duration_seconds=duration)


def test_assume_jit_role_rejects_inactive_session():
    with pytest.raises(ValueError, match="inactive"):
        assume_jit_role(make_session(status="REVOKED"), duration_seconds=900)
