from typing import Literal

from pydantic import BaseModel, Field


PermissionStatusValue = Literal["GRANTED", "DENIED", "INVALID"]
ScanStatusValue = Literal["completed", "blocked", "failed"]


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


class ResourceNodeResponse(BaseModel):
    resource_type: str
    name: str
    scope: str
    self_link: str | None = None
    details: dict[str, object] = Field(default_factory=dict)
    error: str | None = None


class BackendServiceHierarchyResponse(BaseModel):
    backend_service: ResourceNodeResponse
    security_policy: ResourceNodeResponse | None = None


class LoadBalancerHierarchyResponse(BaseModel):
    forwarding_rule: ResourceNodeResponse
    target_proxy: ResourceNodeResponse | None = None
    url_map: ResourceNodeResponse | None = None
    backend_services: list[BackendServiceHierarchyResponse] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ScanResponse(BaseModel):
    project_id: str
    status: ScanStatusValue
    message: str
    service_account_email: str
    preflight: CheckLbPermissionsResponse
    project: ResourceNodeResponse | None = None
    load_balancers: list[LoadBalancerHierarchyResponse] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
