
"""AWS STS helpers for AIC-GATE temporary access sessions."""

from functools import lru_cache
import json
from typing import Any

from aic_gate.config import create_boto3_session, get_settings
from aic_gate.session import AccessSession, get_session_status
from aic_gate.validation import AccessRequest, validate_request


MIN_STS_DURATION_SECONDS = 900
MAX_STS_DURATION_SECONDS = 3600


@lru_cache(maxsize=1)
def get_sts_client():
    settings = get_settings()
    return create_boto3_session(settings.aws_sts_profile).client("sts")


def _build_policy_document(
    bucket: str,
    prefix: str,
    actions: list[str],
) -> dict[str, Any]:
    """Build a least-privilege IAM policy document for an S3 bucket/prefix."""
    normalized_prefix = prefix.strip("/")

    if (
        not bucket
        or not normalized_prefix
        or "\\" in prefix
        or "*" in prefix
        or "?" in prefix
        or any(part in ("", ".", "..") for part in normalized_prefix.split("/"))
    ):
        raise ValueError("Invalid bucket or prefix in access session.")

    if not actions:
        raise ValueError("Session must contain at least one action.")

    allowed_actions = {"s3:GetObject", "s3:ListBucket"}

    if (
        len(actions) != len(set(actions))
        or not all(action in allowed_actions for action in actions)
    ):
        raise ValueError("Session contains an unauthorized action.")

    statements: list[dict[str, Any]] = []

    if "s3:GetObject" in actions:
        statements.append(
            {
                "Sid": "ReadObjectsInApprovedPrefix",
                "Effect": "Allow",
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{bucket}/{normalized_prefix}/*",
            }
        )

    if "s3:ListBucket" in actions:
        statements.append(
            {
                "Sid": "ListOnlyApprovedPrefix",
                "Effect": "Allow",
                "Action": "s3:ListBucket",
                "Resource": f"arn:aws:s3:::{bucket}",
                "Condition": {
                    "StringLike": {
                        "s3:prefix": [
                            normalized_prefix,
                            f"{normalized_prefix}/*",
                        ]
                    }
                },
            }
        )

    return {
        "Version": "2012-10-17",
        "Statement": statements,
    }


def build_session_policy(session: AccessSession) -> dict[str, Any]:
    """Build an STS session policy restricted to the approved session."""

    if get_session_status(session) != "ACTIVE":
        raise ValueError("Cannot issue credentials for an inactive session.")

    return _build_policy_document(
        bucket=session.bucket,
        prefix=session.prefix,
        actions=session.actions,
    )


def preview_session_policy(
    bucket: str,
    prefix: str,
    actions: list[str],
) -> dict[str, Any]:
    """Validate parameters and return the exact STS session policy preview."""
    validate_request(
        AccessRequest(
            bucket=bucket,
            prefix=prefix,
            actions=actions,
            duration_minutes=15,
            reason="policy preview",
        )
    )
    return _build_policy_document(
        bucket=bucket,
        prefix=prefix,
        actions=actions,
    )


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
    settings = get_settings()
    sts = get_sts_client()

    response = sts.assume_role(
        RoleArn=settings.jit_role_arn,
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
