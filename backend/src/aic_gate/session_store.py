
from aic_gate.session import AccessSession
import boto3
from dataclasses import asdict
from decimal import Decimal
from datetime import datetime

TABLE_NAME = "AICGateSession"

def get_sessions_table():
    session = boto3.Session(
        profile_name="aic-gate-logs-reader",
        region_name="ap-south-1",
    )
    dynamodb = session.resource("dynamodb")
    return dynamodb.Table(TABLE_NAME)


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


def load_access_session(session_id: str) -> AccessSession | None:
    item = load_session(session_id)

    if item is None:
        return None

    return AccessSession(
        session_id=item["session_id"],
        bucket=item["bucket"],
        prefix=item["prefix"],
        actions=item["actions"],
        created_at=datetime.fromisoformat(item["created_at"]),
        expires_at=datetime.fromisoformat(item["expires_at"]),
        status=item["status"],
        request_id=item.get("request_id"),
    )
