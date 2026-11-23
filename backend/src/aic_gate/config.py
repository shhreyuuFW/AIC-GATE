"""Centralized environment configuration and cached AWS session helpers."""

from dataclasses import dataclass
from functools import lru_cache
import os

import boto3
from dotenv import load_dotenv

load_dotenv()

DEFAULT_AWS_REGION = "ap-south-1"
DEFAULT_AWS_DATA_PROFILE = "aic-gate-logs-reader"
DEFAULT_AWS_STS_PROFILE = "aic-gate-dev"
DEFAULT_JIT_ROLE_ARN = "arn:aws:iam::023644376485:role/AICGateJITRole"
DEFAULT_SESSIONS_TABLE = "AICGateSession"
DEFAULT_REQUESTS_TABLE = "AICGateAccessRequest"
DEFAULT_ALLOWED_BUCKETS = "cloudsec.proj.aicgate"


@dataclass(frozen=True)
class Settings:
    aws_region: str
    aws_data_profile: str
    aws_sts_profile: str
    jit_role_arn: str
    sessions_table_name: str
    requests_table_name: str
    allowed_buckets: frozenset[str]
    use_default_aws_credentials: bool


def _parse_allowed_buckets(raw_value: str) -> frozenset[str]:
    return frozenset(
        bucket.strip()
        for bucket in raw_value.split(",")
        if bucket.strip()
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings loaded from environment variables."""
    load_dotenv()
    raw_buckets = os.getenv(
        "AIC_GATE_ALLOWED_BUCKETS",
        DEFAULT_ALLOWED_BUCKETS,
    )
    use_default_creds = (
        os.getenv("VERCEL") == "1"
        or os.getenv("AIC_GATE_USE_DEFAULT_AWS_CREDS") == "1"
    )

    return Settings(
        aws_region=os.getenv("AWS_REGION", DEFAULT_AWS_REGION),
        aws_data_profile=os.getenv(
            "AIC_GATE_AWS_PROFILE",
            DEFAULT_AWS_DATA_PROFILE,
        ),
        aws_sts_profile=os.getenv(
            "AIC_GATE_STS_PROFILE",
            DEFAULT_AWS_STS_PROFILE,
        ),
        jit_role_arn=os.getenv(
            "AIC_GATE_JIT_ROLE_ARN",
            DEFAULT_JIT_ROLE_ARN,
        ),
        sessions_table_name=os.getenv(
            "AIC_GATE_SESSIONS_TABLE",
            DEFAULT_SESSIONS_TABLE,
        ),
        requests_table_name=os.getenv(
            "AIC_GATE_REQUESTS_TABLE",
            DEFAULT_REQUESTS_TABLE,
        ),
        allowed_buckets=_parse_allowed_buckets(raw_buckets),
        use_default_aws_credentials=use_default_creds,
    )


def create_boto3_session(profile_name: str) -> boto3.Session:
    """Create a boto3 Session using either default credentials or a named profile."""
    settings = get_settings()
    if settings.use_default_aws_credentials:
        return boto3.Session(region_name=settings.aws_region)

    return boto3.Session(
        profile_name=profile_name,
        region_name=settings.aws_region,
    )
