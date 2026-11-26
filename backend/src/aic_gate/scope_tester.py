"""Multi-service scope verification and simulated lab responders."""

from datetime import datetime, timezone
from typing import Any

from aic_gate.service import read_session_object
from aic_gate.session import AccessSession, get_session_status


def get_scope_tester_presets() -> dict[str, dict[str, Any]]:
    """Return curated positive (ALLOW) and negative (DENY) targets per AWS service."""
    return {
        "s3": {
            "label": "S3 Object Storage",
            "placeholder": "logs/sample.log",
            "allow_presets": [
                {"label": "logs/sample.log (ALLOW)", "query": "logs/sample.log"},
                {"label": "logs/app-events.json (ALLOW)", "query": "logs/app-events.json"},
            ],
            "deny_presets": [
                {"label": "restricted/secret.txt (DENY)", "query": "restricted/secret.txt"},
                {"label": "logs/../restricted/secret.txt (TRAVERSAL DENY)", "query": "logs/../restricted/secret.txt"},
            ],
        },
        "dynamodb": {
            "label": "DynamoDB Telemetry",
            "placeholder": "AICGateSession",
            "allow_presets": [
                {"label": "AICGateSession (ALLOW)", "query": "AICGateSession"},
            ],
            "deny_presets": [
                {"label": "AICGateSecrets (DENY)", "query": "AICGateSecrets"},
                {"label": "prod-billing-ledger (DENY)", "query": "prod-billing-ledger"},
            ],
        },
        "cloudwatch_logs": {
            "label": "CloudWatch Logs",
            "placeholder": "/aic-gate/app",
            "allow_presets": [
                {"label": "/aic-gate/app (ALLOW)", "query": "/aic-gate/app"},
                {"label": "/aic-gate/app/api-stream (ALLOW)", "query": "/aic-gate/app/api-stream"},
            ],
            "deny_presets": [
                {"label": "/aws/security/audit (DENY)", "query": "/aws/security/audit"},
                {"label": "/aic-gate/../root-ssh (TRAVERSAL DENY)", "query": "/aic-gate/../root-ssh"},
            ],
        },
        "ssm": {
            "label": "SSM Parameter Store",
            "placeholder": "/aic-gate/config/runtime",
            "allow_presets": [
                {"label": "/aic-gate/config/runtime (ALLOW)", "query": "/aic-gate/config/runtime"},
                {"label": "/aic-gate/config/region (ALLOW)", "query": "/aic-gate/config/region"},
            ],
            "deny_presets": [
                {"label": "/aic-gate/prod/db_password (DENY)", "query": "/aic-gate/prod/db_password"},
                {"label": "/aic-gate/config/../secrets/key (TRAVERSAL DENY)", "query": "/aic-gate/config/../secrets/key"},
            ],
        },
    }


def _validate_clean_path(raw: str) -> str:
    cleaned = raw.strip()
    if (
        not cleaned
        or "\\" in cleaned
        or "*" in cleaned
        or "?" in cleaned
        or any(ord(c) < 32 for c in cleaned)
    ):
        raise PermissionError("Invalid characters in target scope.")
    parts = [p for p in cleaned.split("/") if p]
    if any(p in (".", "..") for p in parts):
        raise PermissionError("Path traversal segments are strictly denied.")
    return cleaned


def execute_session_scope_test(
    session: AccessSession,
    *,
    target_service: str,
    query: str,
    use_lab_sample: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Verify session bounds for S3, DynamoDB, CloudWatch Logs, or SSM."""
    current_time = now or datetime.now(timezone.utc)
    status = get_session_status(session, current_time)
    if status != "ACTIVE":
        raise PermissionError("Session is not active")

    session_service = (session.service or "s3").strip().lower()
    requested_service = target_service.strip().lower()
    if session_service != requested_service:
        raise PermissionError(
            f"Session is scoped to '{session_service}', not '{requested_service}'."
        )

    clean_query = _validate_clean_path(query)

    if requested_service == "s3":
        if "s3:GetObject" not in session.actions:
            raise PermissionError("Session does not permit s3:GetObject reads.")
        prefix = session.prefix.strip("/")
        if clean_query.startswith("/") or not clean_query.startswith(prefix + "/"):
            raise PermissionError("Object is outside the authorized S3 prefix.")

        if not use_lab_sample:
            content = read_session_object(session.session_id, clean_query, now=current_time)
            return {
                "simulated": False,
                "service": "s3",
                "resource": f"s3://{session.bucket}/{clean_query}",
                "summary": f"200 OK // Live AWS S3 read authorized ({clean_query})",
                "content": content,
            }

        return {
            "simulated": True,
            "service": "s3",
            "resource": f"s3://{session.bucket}/{clean_query}",
            "summary": f"200 OK // LAB SANDBOX S3 read authorized ({clean_query})",
            "content": (
                f"# AIC-GATE SANDBOX OBJECT: {clean_query}\n"
                f"timestamp={current_time.isoformat()} service=api-edge status=200 latency_ms=14\n"
                f"timestamp={current_time.isoformat()} service=sts-broker msg=\"Scoped session verified\"\n"
                "timestamp=2026-11-27T01:12:00Z level=INFO msg=\"Health check nominal\""
            ),
        }

    if requested_service == "dynamodb":
        read_actions = {
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:DescribeTable",
        }
        if not any(a in read_actions for a in session.actions):
            raise PermissionError("Session does not permit DynamoDB read actions.")

        allowed_table = session.bucket.strip()
        if clean_query != allowed_table:
            raise PermissionError(
                f"Table '{clean_query}' is outside authorized DynamoDB session scope ({allowed_table})."
            )

        return {
            "simulated": True,
            "service": "dynamodb",
            "resource": f"dynamodb://{allowed_table}",
            "summary": f"200 OK // LAB SANDBOX DynamoDB Query authorized ({allowed_table})",
            "rows": [
                {
                    "session_id": session.session_id,
                    "service": "s3",
                    "prefix": "logs/",
                    "status": "ACTIVE",
                    "risk_level": "LOW",
                    "expires_at": session.expires_at.isoformat(),
                },
                {
                    "session_id": "sess-991a42bc",
                    "service": "dynamodb",
                    "prefix": "AICGateSession",
                    "status": "EXPIRED",
                    "risk_level": "MEDIUM",
                    "expires_at": "2026-11-26T14:30:00+00:00",
                },
                {
                    "session_id": "sess-442f09de",
                    "service": "cloudwatch_logs",
                    "prefix": "/aic-gate/app",
                    "status": "ACTIVE",
                    "risk_level": "LOW",
                    "expires_at": "2026-11-27T02:15:00+00:00",
                },
            ],
        }

    if requested_service == "cloudwatch_logs":
        read_actions = {
            "logs:DescribeLogStreams",
            "logs:GetLogEvents",
            "logs:FilterLogEvents",
        }
        if not any(a in read_actions for a in session.actions):
            raise PermissionError("Session does not permit CloudWatch Logs reads.")

        allowed_group = session.prefix.rstrip("/")
        if clean_query != allowed_group and not clean_query.startswith(allowed_group + "/"):
            raise PermissionError(
                f"Log group '{clean_query}' is outside authorized scope ({allowed_group})."
            )

        return {
            "simulated": True,
            "service": "cloudwatch_logs",
            "resource": clean_query,
            "summary": f"200 OK // LAB SANDBOX CloudWatch Logs stream authorized ({clean_query})",
            "events": [
                {
                    "timestamp": current_time.isoformat(),
                    "stream": f"{clean_query}/worker-01",
                    "level": "INFO",
                    "message": f"STS AssumeRole issued for session {session.session_id[:8]}",
                },
                {
                    "timestamp": "2026-11-27T01:18:10+00:00",
                    "stream": f"{clean_query}/auth-edge",
                    "level": "INFO",
                    "message": "JWT validation succeeded (HS256, TOTP MFA verified)",
                },
                {
                    "timestamp": "2026-11-27T01:16:44+00:00",
                    "stream": f"{clean_query}/policy-guard",
                    "level": "WARN",
                    "message": "Blocked wildcard prefix escalation attempt before STS compilation",
                },
                {
                    "timestamp": "2026-11-27T01:14:02+00:00",
                    "stream": f"{clean_query}/worker-01",
                    "level": "INFO",
                    "message": "Health probe 200 OK in ap-south-1 (latency 11ms)",
                },
            ],
        }

    if requested_service == "ssm":
        read_actions = {
            "ssm:GetParameter",
            "ssm:GetParametersByPath",
            "ssm:DescribeParameters",
        }
        if not any(a in read_actions for a in session.actions):
            raise PermissionError("Session does not permit SSM Parameter reads.")

        allowed_path = session.prefix.rstrip("/")
        if clean_query != allowed_path and not clean_query.startswith(allowed_path + "/"):
            raise PermissionError(
                f"Parameter path '{clean_query}' is outside authorized SSM scope ({allowed_path})."
            )

        return {
            "simulated": True,
            "service": "ssm",
            "resource": clean_query,
            "summary": f"200 OK // LAB SANDBOX SSM Parameter read authorized ({clean_query})",
            "parameters": [
                {
                    "name": f"{allowed_path}/runtime",
                    "type": "String",
                    "value": "cloud-run-ap-south-1",
                    "version": 3,
                },
                {
                    "name": f"{allowed_path}/region",
                    "type": "String",
                    "value": "ap-south-1",
                    "version": 1,
                },
                {
                    "name": f"{allowed_path}/max_session_minutes",
                    "type": "String",
                    "value": "60",
                    "version": 2,
                },
                {
                    "name": f"{allowed_path}/sts_isolation_mode",
                    "type": "String",
                    "value": "STRICT_INTERSECTION",
                    "version": 4,
                },
            ],
        }

    raise PermissionError(f"Unsupported scope test service: {requested_service}")
