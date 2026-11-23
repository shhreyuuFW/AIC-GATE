
"""DynamoDB persistence for AIC-GATE access requests."""

from dataclasses import asdict
from functools import lru_cache

from botocore.exceptions import ClientError

from aic_gate.access_request import AccessRequestRecord
from aic_gate.config import create_boto3_session, get_settings


@lru_cache(maxsize=1)
def get_access_requests_table():
    settings = get_settings()
    dynamodb = create_boto3_session(settings.aws_data_profile).resource(
        "dynamodb"
    )
    return dynamodb.Table(settings.requests_table_name)


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


def claim_approved_request(request_id: str) -> bool:
    """Atomically claim an approved request for session creation."""
    try:
        get_access_requests_table().update_item(
            Key={"request_id": request_id},
            UpdateExpression="SET #status = :creating",
            ConditionExpression="#status = :approved",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":approved": "APPROVED",
                ":creating": "CREATING_SESSION",
            },
        )
        return True
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == (
            "ConditionalCheckFailedException"
        ):
            return False
        raise


def record_created_session(request_id: str, session_id: str) -> bool:
    """Link a successfully created session to its approved request."""
    try:
        get_access_requests_table().update_item(
            Key={"request_id": request_id},
            UpdateExpression=(
                "SET #status = :created, session_id = :session_id"
            ),
            ConditionExpression="#status = :creating",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":creating": "CREATING_SESSION",
                ":created": "SESSION_CREATED",
                ":session_id": session_id,
            },
        )
        return True

    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == (
            "ConditionalCheckFailedException"
        ):
            return False
        raise
