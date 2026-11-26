"""Approved AWS resource catalog hiding raw ARNs/buckets from client UIs."""

from dataclasses import dataclass
from typing import Literal

ServiceType = Literal["s3", "dynamodb", "cloudwatch_logs", "ssm"]


@dataclass(frozen=True)
class CatalogResource:
    resource_id: str
    service: ServiceType
    label: str
    description: str
    environment: str
    allowed_actions: tuple[str, ...]
    related_resource_ids: tuple[str, ...]
    # Internal AWS targets — resolved server-side, never returned to clients.
    aws_target: str
    default_prefix: str


_RESOURCE_CATALOG: tuple[CatalogResource, ...] = (
    CatalogResource(
        resource_id="s3-app-logs",
        service="s3",
        label="Application Error Logs (S3)",
        description="Read-only access to sanitized application logs stored in S3.",
        environment="lab",
        allowed_actions=("s3:GetObject", "s3:ListBucket"),
        related_resource_ids=("cw-api-logs", "ssm-app-config"),
        aws_target="cloudsec.proj.aicgate",
        default_prefix="logs/",
    ),
    CatalogResource(
        resource_id="ddb-session-audit",
        service="dynamodb",
        label="Session Telemetry Table (DynamoDB)",
        description="Read-only inspection of JIT access session records and status.",
        environment="lab",
        allowed_actions=(
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:DescribeTable",
        ),
        related_resource_ids=("cw-api-logs",),
        aws_target="AICGateSession",
        default_prefix="AICGateSession",
    ),
    CatalogResource(
        resource_id="cw-api-logs",
        service="cloudwatch_logs",
        label="API Runtime Log Stream (CloudWatch Logs)",
        description="Inspect backend API runtime logs and filter security events.",
        environment="lab",
        allowed_actions=(
            "logs:DescribeLogStreams",
            "logs:GetLogEvents",
            "logs:FilterLogEvents",
        ),
        related_resource_ids=("s3-app-logs", "ddb-session-audit", "ssm-app-config"),
        aws_target="/aic-gate/app",
        default_prefix="/aic-gate/app",
    ),
    CatalogResource(
        resource_id="ssm-app-config",
        service="ssm",
        label="Runtime Config Parameters (SSM)",
        description="Read non-secret application parameters under the lab config path.",
        environment="lab",
        allowed_actions=(
            "ssm:GetParameter",
            "ssm:GetParametersByPath",
            "ssm:DescribeParameters",
        ),
        related_resource_ids=("cw-api-logs", "s3-app-logs"),
        aws_target="/aic-gate/config",
        default_prefix="/aic-gate/config",
    ),
)

_CATALOG_BY_ID: dict[str, CatalogResource] = {
    item.resource_id: item for item in _RESOURCE_CATALOG
}


def get_catalog_resource(resource_id: str) -> CatalogResource | None:
    """Resolve an approved catalog resource by ID."""
    return _CATALOG_BY_ID.get(resource_id.strip())


def list_client_catalog() -> list[dict]:
    """Return client-safe catalog metadata without internal AWS ARNs or buckets."""
    return [
        {
            "resource_id": item.resource_id,
            "service": item.service,
            "label": item.label,
            "description": item.description,
            "environment": item.environment,
            "allowed_actions": list(item.allowed_actions),
            "related_resource_ids": list(item.related_resource_ids),
            "default_scope": item.default_prefix,
        }
        for item in _RESOURCE_CATALOG
    ]
