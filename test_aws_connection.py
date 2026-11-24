from aic_gate.aws_client import get_s3_client

s3 = get_s3_client()

response = s3.get_object(
    Bucket="cloudsec.proj.aicgate",
    Key="logs/sample.log",
)

print("AWS connection successful.")
print("Content:")
print(response["Body"].read().decode("utf-8"))
