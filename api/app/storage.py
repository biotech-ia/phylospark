import boto3
from botocore.client import Config
from app.config import get_settings


def get_minio_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.minio_endpoint,
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        config=Config(signature_version="s3v4"),
    )


def upload_file(client, bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream"):
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def download_file(client, bucket: str, key: str) -> bytes:
    response = client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def list_files(client, bucket: str, prefix: str = "") -> list[str]:
    response = client.list_objects_v2(Bucket=bucket, Prefix=prefix)
    return [obj["Key"] for obj in response.get("Contents", [])]
