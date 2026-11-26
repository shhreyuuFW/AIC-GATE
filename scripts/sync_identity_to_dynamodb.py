"""Migrate saved local AIC-GATE identity records into AWS DynamoDB (AICGateIdentity)."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "backend" / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from aic_gate.config import create_boto3_session, get_settings  # noqa: E402


def _collect_items(data: dict) -> list[dict]:
    items: list[dict] = []
    for section in ("orgs", "users", "roles", "notifications", "tickets"):
        for entry in data.get(section, []):
            if isinstance(entry, dict) and entry.get("pk"):
                items.append(entry)

    now = datetime.now(timezone.utc).isoformat()
    for code, org_id in data.get("invites", {}).items():
        clean_code = str(code).strip().upper()
        if clean_code:
            items.append(
                {
                    "pk": f"INVITE#{clean_code}",
                    "entity_type": "INVITE",
                    "invite_code": clean_code,
                    "org_id": str(org_id),
                    "created_at": now,
                }
            )
    return items


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync local AIC-GATE identity JSON snapshot into AWS DynamoDB."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print counts per entity type without writing to AWS DynamoDB.",
    )
    args = parser.parse_args()

    settings = get_settings()
    file_path = Path(settings.identity_file_path)
    if not file_path.is_file():
        print(f"No local identity file found at {file_path}.")
        return 1

    data = json.loads(file_path.read_text(encoding="utf-8"))
    items = _collect_items(data)
    counts: dict[str, int] = {}
    for item in items:
        et = str(item.get("entity_type", "UNKNOWN"))
        counts[et] = counts.get(et, 0) + 1

    print(f"Source file: {file_path}")
    print(f"Target table: {settings.identity_table_name} ({settings.aws_region})")
    print(f"Entity breakdown: {counts} (total {len(items)} items)")

    if args.dry_run:
        print("Dry run complete. No DynamoDB writes performed.")
        return 0

    dynamodb = create_boto3_session(settings.aws_data_profile).resource("dynamodb")
    table = dynamodb.Table(settings.identity_table_name)
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)

    print(f"Successfully synced {len(items)} items into {settings.identity_table_name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
