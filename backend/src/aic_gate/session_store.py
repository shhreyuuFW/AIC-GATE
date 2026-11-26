
from dataclasses import asdict
from datetime import datetime
from functools import lru_cache

from aic_gate.config import create_boto3_session, get_settings
from aic_gate.identity_store import DEFAULT_LAB_ORG_ID
from aic_gate.session import AccessSession


@lru_cache(maxsize=1)
def get_sessions_table():
    settings = get_settings()
    dynamodb = create_boto3_session(settings.aws_data_profile).resource(
        "dynamodb"
    )
    return dynamodb.Table(settings.sessions_table_name)


def save_session(session) -> None:
    table = get_sessions_table()
    item = asdict(session)

    item["actions"] = list(session.actions)
    item["created_at"] = session.created_at.isoformat()
    item["expires_at"] = session.expires_at.isoformat()

    table.put_item(Item=item)


def load_session(session_id: str) -> dict | None:
    table = get_sessions_table()
    response = table.get_item(Key={"session_id": session_id})
    return response.get("Item")


def update_session_status(session_id: str, status: str) -> None:
    table = get_sessions_table()
    table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="SET #status = :status",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":status": status},
        ConditionExpression="attribute_exists(session_id)",
    )


def _item_to_session(item: dict) -> AccessSession:
    return AccessSession(
        session_id=item["session_id"],
        bucket=item["bucket"],
        prefix=item["prefix"],
        actions=item["actions"],
        created_at=datetime.fromisoformat(item["created_at"]),
        expires_at=datetime.fromisoformat(item["expires_at"]),
        status=item["status"],
        request_id=item.get("request_id"),
        requester_id=item.get("requester_id"),
        org_id=item.get("org_id") or DEFAULT_LAB_ORG_ID,
        service=item.get("service") or "s3",
        resource_id=item.get("resource_id"),
    )


def load_access_session(session_id: str) -> AccessSession | None:
    item = load_session(session_id)

    if item is None:
        return None

    return _item_to_session(item)


def list_sessions(
    requester_id: str | None = None,
    org_id: str | None = None,
) -> list[AccessSession]:
    """Return sessions from DynamoDB, optionally filtered by requester/org."""
    table = get_sessions_table()
    items: list[dict] = []
    scan_args: dict = {}

    if requester_id is not None:
        scan_args["FilterExpression"] = "requester_id = :requester_id"
        scan_args["ExpressionAttributeValues"] = {
            ":requester_id": requester_id
        }

    while True:
        response = table.scan(**scan_args)
        items.extend(response.get("Items", []))

        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break

        scan_args["ExclusiveStartKey"] = last_key

    sessions = [_item_to_session(item) for item in items]
    if org_id is not None:
        sessions = [s for s in sessions if s.org_id == org_id]
    sessions.sort(key=lambda s: s.created_at, reverse=True)
    return sessions
