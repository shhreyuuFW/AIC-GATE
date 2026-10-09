
"""Validation rules for AIC-Gate JIT access requests."""

from dataclasses import dataclass
import re


MAX_SESSION_MINUTES = 60
MIN_SESSION_MINUTES = 15

ALLOWED_ACTIONS = {
    "s3:GetObject",
    "s3:ListBucket",
}

BUCKET_NAME_PATTERN = re.compile(
    r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$"
)


@dataclass(frozen=True)
class AccessRequest:
    bucket: str
    prefix: str
    actions: list[str]
    duration_minutes: int
    reason: str


def validate_request(request: AccessRequest) -> None:
    """Raise ValueError when an access request violates policy."""

    if not BUCKET_NAME_PATTERN.fullmatch(request.bucket):
        raise ValueError("Invalid bucket name.")

    # Only explicitly configured lab buckets may be accessed.
    if request.bucket != "aic-gate-lab":
        raise ValueError("Bucket is not allowlisted.")

    if not isinstance(request.prefix, str) or not request.prefix.strip():
        raise ValueError("An S3 prefix is required.")

    if (
        request.prefix.startswith("/")
        or "\\" in request.prefix
        or any(part == ".." for part in request.prefix.split("/"))
        or any(ord(char) < 32 for char in request.prefix)
    ):
        raise ValueError("Invalid S3 prefix.")

    if not isinstance(request.actions, list) or not request.actions:
        raise ValueError("At least one action is required.")

    if len(request.actions) != len(set(request.actions)):
        raise ValueError("Duplicate actions are not allowed.")

    if not all(
        isinstance(action, str) and action in ALLOWED_ACTIONS
        for action in request.actions
    ):
        raise ValueError("One or more actions are not permitted.")

    if (
        not isinstance(request.duration_minutes, int)
        or isinstance(request.duration_minutes, bool)
        or not MIN_SESSION_MINUTES
        <= request.duration_minutes
        <= MAX_SESSION_MINUTES
    ):
        raise ValueError(
            f"Session duration must be between "
            f"{MIN_SESSION_MINUTES} and {MAX_SESSION_MINUTES} minutes."
        )

    if not isinstance(request.reason, str) or not request.reason.strip():
        raise ValueError("A reason for access is required.")

    if len(request.reason) > 300:
        raise ValueError("Reason must be 300 characters or fewer.")
