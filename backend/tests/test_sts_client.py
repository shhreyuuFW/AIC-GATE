
from datetime import datetime, timedelta, timezone

import pytest

from aic_gate.session import AccessSession
from aic_gate.sts_client import build_session_policy


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


@pytest.mark.parametrize("prefix", ["", "../secret", "logs/../secret", "logs//secret"])
def test_invalid_prefix_is_rejected(prefix):
    with pytest.raises(ValueError):
        build_session_policy(make_session(prefix=prefix))


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
