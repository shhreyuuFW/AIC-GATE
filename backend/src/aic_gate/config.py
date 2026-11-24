"""Centralized environment configuration and cached AWS session helpers."""

from dataclasses import dataclass
from functools import lru_cache
import os
import secrets

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
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:8000"
)
DEFAULT_JWT_TTL_MINUTES = 60

_DEV_EPHEMERAL_JWT_SECRET = secrets.token_urlsafe(48)


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
    environment: str
    jwt_secret: str
    jwt_ttl_minutes: int
    demo_users_enabled: bool
    demo_requester_password: str
    demo_admin_password: str
    cors_origins: tuple[str, ...]


def _parse_csv(raw_value: str) -> tuple[str, ...]:
    return tuple(
        item.strip()
        for item in raw_value.split(",")
        if item.strip()
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings loaded from environment variables."""
    load_dotenv()
    environment = os.getenv("AIC_GATE_ENV", "development").strip().lower()
    raw_buckets = os.getenv(
        "AIC_GATE_ALLOWED_BUCKETS",
        DEFAULT_ALLOWED_BUCKETS,
    )
    use_default_creds = (
        os.getenv("VERCEL") == "1"
        or os.getenv("AIC_GATE_USE_DEFAULT_AWS_CREDS") == "1"
    )

    raw_jwt_secret = os.getenv("AIC_GATE_JWT_SECRET", "").strip()
    if environment == "production":
        if len(raw_jwt_secret) < 32:
            raise RuntimeError(
                "AIC_GATE_JWT_SECRET must be set to at least 32 characters in production."
            )
        jwt_secret = raw_jwt_secret
    else:
        jwt_secret = raw_jwt_secret or _DEV_EPHEMERAL_JWT_SECRET

    jwt_ttl_minutes = int(
        os.getenv("AIC_GATE_JWT_TTL_MINUTES", str(DEFAULT_JWT_TTL_MINUTES))
    )
    demo_default = "0" if environment == "production" else "1"
    demo_users_enabled = (
        os.getenv("AIC_GATE_DEMO_USERS_ENABLED", demo_default) == "1"
    )
    raw_cors = os.getenv("AIC_GATE_CORS_ORIGINS", DEFAULT_CORS_ORIGINS)

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
        allowed_buckets=frozenset(_parse_csv(raw_buckets)),
        use_default_aws_credentials=use_default_creds,
        environment=environment,
        jwt_secret=jwt_secret,
        jwt_ttl_minutes=jwt_ttl_minutes,
        demo_users_enabled=demo_users_enabled,
        demo_requester_password=os.getenv(
            "AIC_GATE_DEMO_REQUESTER_PASSWORD",
            "operator-demo-pass",
        ),
        demo_admin_password=os.getenv(
            "AIC_GATE_DEMO_ADMIN_PASSWORD",
            "commander-demo-pass",
        ),
        cors_origins=_parse_csv(raw_cors),
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
