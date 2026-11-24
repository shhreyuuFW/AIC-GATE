"""Live AWS integration tests proving STS session-policy S3 boundaries."""

from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError
import pytest

from aic_gate.config import get_settings
from aic_gate.session import AccessSession
from aic_gate.sts_client import assume_jit_role

pytestmark = pytest.mark.integration

BUCKET = "cloudsec.proj.aicgate"


def test_issued_sts_credentials_enforce_prefix_and_action_scope():
    now = datetime.now(timezone.utc)
    session = AccessSession(
        session_id="integration-sts-scope-01",
        bucket=BUCKET,
        prefix="logs/",
        actions=["s3:GetObject", "s3:ListBucket"],
        created_at=now,
        expires_at=now + timedelta(minutes=15),
        status="ACTIVE",
        requester_id="integration-test",
    )

    creds = assume_jit_role(session, duration_seconds=900)
    settings = get_settings()

    scoped_s3 = boto3.client(
        "s3",
        aws_access_key_id=creds["access_key_id"],
        aws_secret_access_key=creds["secret_access_key"],
        aws_session_token=creds["session_token"],
        region_name=settings.aws_region,
    )

    # 1. Allowed object read inside approved prefix
    obj = scoped_s3.get_object(Bucket=BUCKET, Key="logs/sample.log")
    try:
        body = obj["Body"].read().decode("utf-8")
    finally:
        obj["Body"].close()
    assert "AIC-Gate lab started" in body

    # 2. Allowed bucket listing scoped to approved prefix
    listed = scoped_s3.list_objects_v2(Bucket=BUCKET, Prefix="logs/")
    keys = [item["Key"] for item in listed.get("Contents", [])]
    assert "logs/sample.log" in keys

    # 3. Denied object read outside approved prefix
    with pytest.raises(ClientError) as denied_read:
        scoped_s3.get_object(Bucket=BUCKET, Key="restricted/secret.txt")
    assert denied_read.value.response["Error"]["Code"] == "AccessDenied"

    # 4. Denied unrequested write action even inside approved prefix
    with pytest.raises(ClientError) as denied_write:
        scoped_s3.put_object(
            Bucket=BUCKET,
            Key="logs/should-fail.txt",
            Body=b"denied",
        )
    assert denied_write.value.response["Error"]["Code"] == "AccessDenied"
