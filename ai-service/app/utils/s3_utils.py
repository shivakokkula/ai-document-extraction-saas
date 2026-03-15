import boto3
from botocore.config import Config
from app.config import settings
import structlog

logger = structlog.get_logger()

def get_s3_client():
    kwargs = dict(region_name=settings.aws_region)

    # Only pass explicit credentials when both values are non-empty.
    # If missing, let boto3 resolve credentials from default provider chain
    # (env vars, shared profile, IAM role, etc).
    has_explicit_creds = bool(settings.aws_access_key_id and settings.aws_secret_access_key)
    if has_explicit_creds:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    else:
        logger.warning(
            "s3.credentials_missing_or_partial",
            mode="default_provider_chain",
            has_access_key=bool(settings.aws_access_key_id),
            has_secret=bool(settings.aws_secret_access_key),
        )

    raw_endpoint = (settings.aws_s3_endpoint or "").strip()
    # Guard against inline comments or invalid values from .env files.
    if raw_endpoint and raw_endpoint.startswith(("http://", "https://")):
        kwargs["endpoint_url"] = raw_endpoint
    elif raw_endpoint:
        logger.warning("s3.endpoint_ignored", reason="invalid_endpoint_format", raw_value=raw_endpoint)

    return boto3.client("s3", **kwargs, config=Config(signature_version="s3v4"))

async def download_from_s3(bucket: str, key: str) -> bytes:
    s3 = get_s3_client()
    logger.info("s3.get_object.start", bucket=bucket, key=key)
    response = s3.get_object(Bucket=bucket, Key=key)
    logger.info("s3.get_object.success", bucket=bucket, key=key)
    return response["Body"].read()
