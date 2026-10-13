
"""AWS STS helpers for AIC-GATE temporary access sessions."""

import json
from datetime import datetime, timezone
from typing import Any

import boto3

from aic_gate.session import AccessSession, get_session_status


AWS_REGION = "ap-south-1"
JIT_ROLE_ARN = (
    "arn:aws:iam::023644376485:role/AICGateJITRole"
)

MIN_STS_DURATION_SECONDS = 900
MAX_STS_DURATION_SECONDS = 3600


def build_session_policy(session: AccessSession) -> dict[str, Any]:
    """Build an STS session policy restricted to the approved session."""

    if get_session_status(session) != "ACTIVE":
        raise ValueError("Cannot issue credentials for an inactive session.")

    bucket = session.bucket
    prefix = session.prefix.strip("/")

    if (
        not bucket
        or not prefix
        or "\\" in prefix
        or any(part in ("", ".", "..") for part in prefix.split("/"))
    ):
        raise ValueError("Invalid bucket or prefix in access session.")

    if not session.actions:
        raise ValueError("Session must contain at least one action.")

    allowed_actions = {"s3:GetObject", "s3:ListBucket"}

    if (
        len(session.actions) != len(set(session.actions))
        or not all(action in allowed_actions for action in session.actions)
    ):
        raise ValueError("Session contains an unauthorized action.")

    statements: list[dict[str, Any]] = []

    if "s3:GetObject" in session.actions:
        statements.append(
            {
                "Sid": "ReadObjectsInApprovedPrefix",
                "Effect": "Allow",
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{bucket}/{prefix}/*",
            }
        )

    if "s3:ListBucket" in session.actions:
        statements.append(
            {
                "Sid": "ListOnlyApprovedPrefix",
                "Effect": "Allow",
                "Action": "s3:ListBucket",
                "Resource": f"arn:aws:s3:::{bucket}",
                "Condition": {
                    "StringLike": {
                        "s3:prefix": [prefix, f"{prefix}/*"]
                    }
                },
            }
        )

    return {
        "Version": "2012-10-17",
        "Statement": statements,
    }


def assume_jit_role(
    session: AccessSession,
    duration_seconds: int,
) -> dict[str, Any]:
    """Assume the dedicated JIT role with a restrictive session policy.

    This function returns credentials in memory. Callers must not log
    or persist the secret access key or session token.
    """

    if get_session_status(session) != "ACTIVE":
        raise ValueError("Cannot issue credentials for an inactive session.")

    if (
        isinstance(duration_seconds, bool)
        or not isinstance(duration_seconds, int)
        or not MIN_STS_DURATION_SECONDS
        <= duration_seconds
        <= MAX_STS_DURATION_SECONDS
    ):
        raise ValueError("STS duration must be between 900 and 3600 seconds.")

    policy = build_session_policy(session)

    source = boto3.Session(
        profile_name="aic-gate-dev",
        region_name=AWS_REGION,
    )
    sts = source.client("sts")

    response = sts.assume_role(
        RoleArn=JIT_ROLE_ARN,
        RoleSessionName=f"aic-gate-{session.session_id[:8]}",
        DurationSeconds=duration_seconds,
        Policy=json.dumps(policy, separators=(",", ":")),
    )

    credentials = response["Credentials"]

    return {
        "access_key_id": credentials["AccessKeyId"],
        "secret_access_key": credentials["SecretAccessKey"],
        "session_token": credentials["SessionToken"],
        "expires_at": credentials["Expiration"],
    }
