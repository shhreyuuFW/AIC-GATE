"""Unit tests for centralized configuration."""

from aic_gate.config import get_settings


def test_get_settings_defaults(monkeypatch):
    for var in (
        "AWS_REGION",
        "AIC_GATE_AWS_PROFILE",
        "AIC_GATE_STS_PROFILE",
        "AIC_GATE_JIT_ROLE_ARN",
        "AIC_GATE_SESSIONS_TABLE",
        "AIC_GATE_REQUESTS_TABLE",
        "AIC_GATE_ALLOWED_BUCKETS",
        "VERCEL",
        "AIC_GATE_USE_DEFAULT_AWS_CREDS",
    ):
        monkeypatch.delenv(var, raising=False)

    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.aws_region == "ap-south-1"
        assert settings.aws_data_profile == "aic-gate-logs-reader"
        assert settings.aws_sts_profile == "aic-gate-dev"
        assert settings.sessions_table_name == "AICGateSession"
        assert settings.requests_table_name == "AICGateAccessRequest"
        assert settings.allowed_buckets == frozenset({"cloudsec.proj.aicgate"})
        assert settings.use_default_aws_credentials is False
    finally:
        get_settings.cache_clear()


def test_get_settings_env_overrides(monkeypatch):
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("AIC_GATE_AWS_PROFILE", "custom-reader")
    monkeypatch.setenv("AIC_GATE_STS_PROFILE", "custom-sts")
    monkeypatch.setenv(
        "AIC_GATE_JIT_ROLE_ARN",
        "arn:aws:iam::111122223333:role/CustomRole",
    )
    monkeypatch.setenv("AIC_GATE_SESSIONS_TABLE", "CustomSessions")
    monkeypatch.setenv("AIC_GATE_REQUESTS_TABLE", "CustomRequests")
    monkeypatch.setenv("AIC_GATE_ALLOWED_BUCKETS", "bucket-a, bucket-b ")
    monkeypatch.setenv("AIC_GATE_USE_DEFAULT_AWS_CREDS", "1")

    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.aws_region == "us-east-1"
        assert settings.aws_data_profile == "custom-reader"
        assert settings.aws_sts_profile == "custom-sts"
        assert (
            settings.jit_role_arn
            == "arn:aws:iam::111122223333:role/CustomRole"
        )
        assert settings.sessions_table_name == "CustomSessions"
        assert settings.requests_table_name == "CustomRequests"
        assert settings.allowed_buckets == frozenset({"bucket-a", "bucket-b"})
        assert settings.use_default_aws_credentials is True
    finally:
        get_settings.cache_clear()
