import boto3
from botocore.config import Config
from app.config import settings

def get_s3_client():
    kwargs = dict(
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    if settings.aws_s3_endpoint:
        kwargs["endpoint_url"] = settings.aws_s3_endpoint
    return boto3.client("s3", **kwargs, config=Config(signature_version="s3v4"))

async def download_from_s3(bucket: str, key: str) -> bytes:
    s3 = get_s3_client()
    response = s3.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()
