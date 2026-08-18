from typing import Literal

from pydantic import BaseModel, Field


PermissionStatusValue = Literal["GRANTED", "DENIED", "INVALID"]


class CheckLbPermissionsRequest(BaseModel):
    project_id: str = Field(
        ...,
        min_length=6,
        max_length=30,
        pattern=r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$",
        description="GCP project ID to check",
        examples=["my-gcp-project"],
    )


class PermissionCheckResult(BaseModel):
    permission: str
    status: PermissionStatusValue
    scope: str
    resource: str


class PermissionManifestEntry(BaseModel):
    permission: str
    scope: str


class PermissionManifestResponse(BaseModel):
    manifest_path: str
    permissions: list[PermissionManifestEntry]


class ServiceAccountInfo(BaseModel):
    email: str
    unique_id: str | None = None
    auth_method: str = "adc"


class CheckLbPermissionsResponse(BaseModel):
    project_id: str
    service_account_email: str
    all_permissions_granted: bool
    permissions: list[PermissionCheckResult]
    missing_permissions: list[str]
    invalid_permissions: list[str]
    message: str
    logs: list[str] = Field(default_factory=list)
