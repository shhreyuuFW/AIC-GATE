"""Unit tests for 4-service AWS catalog and multi-service STS policy compiler."""

import pytest

from aic_gate.catalog import get_catalog_resource, list_client_catalog
from aic_gate.sts_client import preview_session_policy
from aic_gate.validation import AccessRequest, compute_risk_level, validate_request


def test_client_catalog_hides_internal_aws_identifiers():
    items = list_client_catalog()
    assert len(items) == 4
    services = {item["service"] for item in items}
    assert services == {"s3", "dynamodb", "cloudwatch_logs", "ssm"}

    serialized = str(items)
    assert "cloudsec.proj.aicgate" not in serialized
    assert "023644376485" not in serialized
    assert "arn:aws:" not in serialized


def test_multi_service_policy_compiler_all_four_services():
    # 1. S3
    s3_policy = preview_session_policy(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject", "s3:ListBucket"],
        service="s3",
    )
    assert len(s3_policy["Statement"]) == 2

    # 2. DynamoDB
    ddb_policy = preview_session_policy(
        bucket="AICGateSession",
        prefix="AICGateSession",
        actions=["dynamodb:GetItem", "dynamodb:DescribeTable"],
        service="dynamodb",
    )
    assert (
        ddb_policy["Statement"][0]["Resource"]
        == "arn:aws:dynamodb:ap-south-1:023644376485:table/AICGateSession"
    )

    # 3. CloudWatch Logs
    cw_policy = preview_session_policy(
        bucket="/aic-gate/app",
        prefix="/aic-gate/app",
        actions=["logs:DescribeLogStreams", "logs:GetLogEvents"],
        service="cloudwatch_logs",
    )
    assert (
        "log-group:/aic-gate/app*:*"
        in cw_policy["Statement"][0]["Resource"]
    )

    # 4. SSM Parameter Store
    ssm_policy = preview_session_policy(
        bucket="/aic-gate/config",
        prefix="/aic-gate/config",
        actions=["ssm:GetParameter", "ssm:DescribeParameters"],
        service="ssm",
    )
    assert len(ssm_policy["Statement"]) == 2
    assert (
        "parameter/aic-gate/config*"
        in ssm_policy["Statement"][0]["Resource"]
    )


@pytest.mark.parametrize(
    "service,bucket,prefix,actions",
    [
        ("dynamodb", "UnauthorizedTable", "UnauthorizedTable", ["dynamodb:GetItem"]),
        ("dynamodb", "AICGateSession", "AICGateSession", ["dynamodb:DeleteItem"]),
        ("cloudwatch_logs", "/aws/lambda/prod", "/aws/lambda/prod", ["logs:GetLogEvents"]),
        ("cloudwatch_logs", "/aic-gate/*", "/aic-gate/*", ["logs:GetLogEvents"]),
        ("ssm", "/prod/secrets", "/prod/secrets", ["ssm:GetParameter"]),
        ("ssm", "/aic-gate/config/*", "/aic-gate/config/*", ["ssm:GetParameter"]),
        ("ec2", "i-123", "i-123", ["ec2:DescribeInstances"]),
    ],
)
def test_multi_service_rejects_unapproved_scopes_and_actions(
    service, bucket, prefix, actions
):
    with pytest.raises(ValueError):
        validate_request(
            AccessRequest(
                bucket=bucket,
                prefix=prefix,
                actions=actions,
                duration_minutes=15,
                reason="Negative test",
                service=service,
            )
        )


def test_risk_level_scoring():
    assert compute_risk_level("cloudwatch_logs", ["logs:DescribeLogStreams"], 15) == "LOW"
    assert compute_risk_level("s3", ["s3:GetObject", "s3:ListBucket"], 30) == "MEDIUM"
    assert compute_risk_level("dynamodb", ["dynamodb:Scan"], 60) == "HIGH"
    assert get_catalog_resource("s3-app-logs") is not None
