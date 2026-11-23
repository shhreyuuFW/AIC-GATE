from functools import lru_cache

from aic_gate.config import create_boto3_session, get_settings


@lru_cache(maxsize=1)
def get_s3_client():
    settings = get_settings()
    return create_boto3_session(settings.aws_data_profile).client("s3")


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
