"""AWS STS helpers and multi-service inline session policy compiler."""

from functools import lru_cache
import json
from typing import Any

from aic_gate.config import create_boto3_session, get_settings
from aic_gate.session import AccessSession, get_session_status
from aic_gate.validation import (
    SERVICE_ALLOWED_ACTIONS,
    AccessRequest,
    validate_request,
)

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
    service: str = "s3",
) -> dict[str, Any]:
    """Build a least-privilege IAM session policy for the approved service."""
    normalized_service = service.strip().lower()
    if normalized_service not in SERVICE_ALLOWED_ACTIONS:
        raise ValueError(f"Unsupported AWS service: {service}")

    if not actions:
        raise ValueError("Session must contain at least one action.")

    allowed_actions = SERVICE_ALLOWED_ACTIONS[normalized_service]
    if len(actions) != len(set(actions)) or not all(
        action in allowed_actions for action in actions
    ):
        raise ValueError("Session contains an unauthorized action.")

    settings = get_settings()
    statements: list[dict[str, Any]] = []

    if normalized_service == "s3":
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

    elif normalized_service == "dynamodb":
        if not bucket or "*" in bucket or "?" in bucket:
            raise ValueError("Invalid DynamoDB table in access session.")
        statements.append(
            {
                "Sid": "ReadOnlyApprovedDynamoDBTable",
                "Effect": "Allow",
                "Action": list(actions),
                "Resource": (
                    f"arn:aws:dynamodb:{settings.aws_region}:{settings.aws_account_id}"
                    f":table/{bucket}"
                ),
            }
        )

    elif normalized_service == "cloudwatch_logs":
        if (
            not prefix.startswith("/aic-gate/")
            or "*" in prefix
            or "?" in prefix
            or ".." in prefix.split("/")
        ):
            raise ValueError("Invalid CloudWatch log group prefix.")
        clean_group = prefix.rstrip("/")
        statements.append(
            {
                "Sid": "ReadApprovedCloudWatchLogs",
                "Effect": "Allow",
                "Action": list(actions),
                "Resource": (
                    f"arn:aws:logs:{settings.aws_region}:{settings.aws_account_id}"
                    f":log-group:{clean_group}*:*"
                ),
            }
        )

    elif normalized_service == "ssm":
        if (
            not prefix.startswith("/aic-gate/config")
            or "*" in prefix
            or "?" in prefix
            or ".." in prefix.split("/")
        ):
            raise ValueError("Invalid SSM parameter path.")
        clean_path = prefix.rstrip("/")
        path_actions = [a for a in actions if a != "ssm:DescribeParameters"]
        if path_actions:
            statements.append(
                {
                    "Sid": "ReadApprovedSSMParameters",
                    "Effect": "Allow",
                    "Action": path_actions,
                    "Resource": (
                        f"arn:aws:ssm:{settings.aws_region}:{settings.aws_account_id}"
                        f":parameter{clean_path}*"
                    ),
                }
            )
        if "ssm:DescribeParameters" in actions:
            statements.append(
                {
                    "Sid": "DescribeSSMParametersMetadata",
                    "Effect": "Allow",
                    "Action": "ssm:DescribeParameters",
                    "Resource": "*",
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
        service=getattr(session, "service", "s3"),
    )


def preview_session_policy(
    bucket: str,
    prefix: str,
    actions: list[str],
    service: str = "s3",
) -> dict[str, Any]:
    """Validate parameters and return the exact STS session policy preview."""
    validate_request(
        AccessRequest(
            bucket=bucket,
            prefix=prefix,
            actions=actions,
            duration_minutes=15,
            reason="policy preview",
            service=service,
        )
    )
    return _build_policy_document(
        bucket=bucket,
        prefix=prefix,
        actions=actions,
        service=service,
    )


def assume_jit_role(
    session: AccessSession,
    duration_seconds: int,
) -> dict[str, Any]:
    """Assume the dedicated JIT role with a restrictive session policy."""
    if get_session_status(session) != "ACTIVE":
        raise ValueError("Cannot issue credentials for an inactive session.")

    if (
        isinstance(duration_seconds, bool)
        or not isinstance(duration_seconds, int)
        or not MIN_STS_DURATION_SECONDS <= duration_seconds <= MAX_STS_DURATION_SECONDS
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
