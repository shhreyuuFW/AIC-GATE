
"""DynamoDB persistence for AIC-GATE access requests."""

import os
import boto3
from botocore.exceptions import ClientError
from dataclasses import asdict

from aic_gate.access_request import AccessRequestRecord

TABLE_NAME = "AICGateAccessRequest"
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")


def get_access_requests_table():
    if os.getenv("VERCEL") == "1":
        session = boto3.Session(region_name=AWS_REGION)
    else:
        profile = os.getenv(
            "AIC_GATE_AWS_PROFILE",
            "aic-gate-logs-reader",
        )
        session = boto3.Session(
            profile_name=profile,
            region_name=AWS_REGION,
        )

    return session.resource("dynamodb").Table(TABLE_NAME)


def save_access_request(request: AccessRequestRecord):
    item = asdict(request)
    item["created_at"] = request.created_at.isoformat()
    item["reviewed_at"] = (
        request.reviewed_at.isoformat()
        if request.reviewed_at
        else None
    )

    get_access_requests_table().put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(request_id)",
    )


def load_access_request(request_id: str):
    response = get_access_requests_table().get_item(
        Key={"request_id": request_id},
        ConsistentRead=True,
    )
    return response.get("Item")


def update_access_request(
    request_id: str,
    status: str,
    reviewed_by: str,
    reviewed_at,
    expected_status: str = "PENDING",
) -> bool:
    try:
        get_access_requests_table().update_item(
            Key={"request_id": request_id},
            UpdateExpression=(
                "SET #status = :status, "
                "reviewed_by = :reviewed_by, "
                "reviewed_at = :reviewed_at"
            ),
            ConditionExpression="#status = :expected_status",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": status,
                ":reviewed_by": reviewed_by,
                ":reviewed_at": reviewed_at.isoformat(),
                ":expected_status": expected_status,
            },
        )
        return True

    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code")
        if error_code == "ConditionalCheckFailedException":
            return False
        raise


def list_access_requests(status: str | None = None):
    """Return requests, optionally filtered by status.

    Scan pagination is handled here. For a small prototype this is
    acceptable; a production system should use a suitable index/query.
    """
    table = get_access_requests_table()
    items = []
    scan_args = {}

    if status is not None:
        scan_args["FilterExpression"] = "#status = :status"
        scan_args["ExpressionAttributeNames"] = {
            "#status": "status"
        }
        scan_args["ExpressionAttributeValues"] = {
            ":status": status
        }

    while True:
        response = table.scan(**scan_args)
        items.extend(response.get("Items", []))

        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break

        scan_args["ExclusiveStartKey"] = last_key

    return sorted(
        items,
        key=lambda item: item.get("created_at", ""),
        reverse=True,
    )
