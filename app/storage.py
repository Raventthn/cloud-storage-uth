"""S3-compatible private object storage used by the API (MinIO in the demo)."""
import os
import time
from functools import lru_cache

import boto3
from botocore.config import Config


@lru_cache
def client():
    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT", "http://minio:9000"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
        config=Config(signature_version="s3v4"),
    )


def bucket_name() -> str:
    return os.getenv("S3_BUCKET", "cloud-files")


def ensure_bucket() -> None:
    s3 = client()
    name = bucket_name()
    # MinIO may still be starting when Docker marks its container as started.
    for attempt in range(15):
        try:
            s3.head_bucket(Bucket=name)
            return
        except Exception:
            try:
                s3.create_bucket(Bucket=name)
                return
            except Exception:
                if attempt == 14:
                    raise
                time.sleep(2)


def put_object(key: str, data, content_type: str | None = None) -> None:
    args = {"Bucket": bucket_name(), "Key": key, "Body": data}
    if content_type:
        args["ContentType"] = content_type
    client().put_object(**args)


def get_object_stream(key: str):
    return client().get_object(Bucket=bucket_name(), Key=key)["Body"]


def delete_object(key: str) -> None:
    client().delete_object(Bucket=bucket_name(), Key=key)
