"""Validation rules and risk scoring for AIC-GATE JIT access requests."""

from dataclasses import dataclass
import re
from typing import Literal

from aic_gate.config import get_settings

MAX_SESSION_MINUTES = 60
MIN_SESSION_MINUTES = 15

SERVICE_ALLOWED_ACTIONS: dict[str, set[str]] = {
    "s3": {"s3:GetObject", "s3:ListBucket"},
    "dynamodb": {
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:DescribeTable",
    },
    "cloudwatch_logs": {
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
        "logs:FilterLogEvents",
    },
    "ssm": {
        "ssm:GetParameter",
        "ssm:GetParametersByPath",
        "ssm:DescribeParameters",
    },
}

# Keep backward-compatible alias for S3 tests/imports
ALLOWED_ACTIONS = SERVICE_ALLOWED_ACTIONS["s3"]

BUCKET_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")


@dataclass(frozen=True)
class AccessRequest:
    bucket: str
    prefix: str
    actions: list[str]
    duration_minutes: int
    reason: str
    service: str = "s3"
    resource_id: str | None = None


def _reject_unsafe_chars(value: str) -> bool:
    return (
        "\\" in value
        or "*" in value
        or "?" in value
        or any(ord(char) < 32 for char in value)
    )


def validate_request(request: AccessRequest) -> None:
    """Raise ValueError when an access request violates service/scope policy."""
    service = request.service.strip().lower()
    if service not in SERVICE_ALLOWED_ACTIONS:
        raise ValueError(f"Unsupported AWS service: {request.service}")

    settings = get_settings()

    if service == "s3":
        if not BUCKET_NAME_PATTERN.fullmatch(request.bucket):
            raise ValueError("Invalid bucket name.")
        if request.bucket not in settings.allowed_buckets:
            raise ValueError("Bucket is not allowlisted.")

        if not isinstance(request.prefix, str) or not request.prefix.strip():
            raise ValueError("An S3 prefix is required.")
        if request.prefix.startswith("/") or _reject_unsafe_chars(request.prefix):
            raise ValueError("Invalid S3 prefix.")
        normalized_prefix = request.prefix.strip("/")
        if not normalized_prefix or any(
            part in ("", ".", "..") for part in normalized_prefix.split("/")
        ):
            raise ValueError("Invalid S3 prefix.")

    elif service == "dynamodb":
        allowed_tables = {
            settings.sessions_table_name,
            settings.requests_table_name,
        }
        if request.bucket not in allowed_tables:
            raise ValueError("DynamoDB table is not allowlisted.")
        if not isinstance(request.prefix, str) or _reject_unsafe_chars(
            request.prefix
        ):
            raise ValueError("Invalid DynamoDB scope.")

    elif service == "cloudwatch_logs":
        if (
            not isinstance(request.prefix, str)
            or not request.prefix.startswith("/aic-gate/")
            or _reject_unsafe_chars(request.prefix)
            or ".." in request.prefix.split("/")
        ):
            raise ValueError("CloudWatch log group must start with /aic-gate/.")

    elif service == "ssm":
        if (
            not isinstance(request.prefix, str)
            or not request.prefix.startswith("/aic-gate/config")
            or _reject_unsafe_chars(request.prefix)
            or ".." in request.prefix.split("/")
        ):
            raise ValueError("SSM parameter path must start with /aic-gate/config.")

    if not isinstance(request.actions, list) or not request.actions:
        raise ValueError("At least one action is required.")

    if len(request.actions) != len(set(request.actions)):
        raise ValueError("Duplicate actions are not allowed.")

    allowed_for_service = SERVICE_ALLOWED_ACTIONS[service]
    if not all(
        isinstance(action, str) and action in allowed_for_service
        for action in request.actions
    ):
        raise ValueError("One or more actions are not permitted.")

    if (
        not isinstance(request.duration_minutes, int)
        or isinstance(request.duration_minutes, bool)
        or not MIN_SESSION_MINUTES <= request.duration_minutes <= MAX_SESSION_MINUTES
    ):
        raise ValueError(
            f"Session duration must be between "
            f"{MIN_SESSION_MINUTES} and {MAX_SESSION_MINUTES} minutes."
        )

    if not isinstance(request.reason, str) or not request.reason.strip():
        raise ValueError("A reason for access is required.")

    if len(request.reason) > 300:
        raise ValueError("Reason must be 300 characters or fewer.")


def compute_risk_level(
    service: str,
    actions: list[str],
    duration_minutes: int,
) -> Literal["LOW", "MEDIUM", "HIGH"]:
    """Compute an automated risk badge for admin triage."""
    score = 0
    if service in ("dynamodb", "ssm"):
        score += 2
    elif service == "s3":
        score += 1

    broad_actions = {
        "dynamodb:Scan",
        "ssm:GetParametersByPath",
        "s3:GetObject",
        "logs:FilterLogEvents",
    }
    if any(action in broad_actions for action in actions):
        score += 2
    if len(actions) > 2:
        score += 1
    if duration_minutes >= 45:
        score += 2
    elif duration_minutes >= 30:
        score += 1

    if score >= 5:
        return "HIGH"
    if score >= 3:
        return "MEDIUM"
    return "LOW"
