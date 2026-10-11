
from botocore.exceptions import ClientError
import pytest
from aic_gate.aws_client import get_s3_client

BUCKET = "cloudsec.proj.aicgate"


def test_can_read_logs_object():
    s3 = get_s3_client()

    response = s3.get_object(
        Bucket=BUCKET,
        Key="logs/sample.log",
    )

    try:
        content = response["Body"].read().decode("utf-8")
        assert "AIC-Gate lab started" in content
    finally:
        response["Body"].close()


def test_cannot_read_restricted_object():
    s3 = get_s3_client()

    with pytest.raises(ClientError) as exc_info:
        s3.get_object(
            Bucket=BUCKET,
            Key="restricted/secret.txt",
        )

    assert exc_info.value.response["Error"]["Code"] == "AccessDenied"
