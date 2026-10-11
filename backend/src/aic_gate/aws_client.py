import boto3
from aic_gate.validation import validate_request

def get_s3_client():
    return boto3.Session(
        profile_name="aic-gate-logs-reader",
        region_name="ap-south-1",
    ).client("s3")


def read_s3_object(bucket: str, key: str) -> str:
    s3 = get_s3_client()

    response = s3.get_object(
        Bucket=bucket,
        Key=key,
    )

    try:
        return response["Body"].read().decode("utf-8")
    finally:
        response["Body"].close()
