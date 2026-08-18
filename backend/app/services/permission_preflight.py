from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Literal

import yaml
from google.api_core import exceptions as google_exceptions
from google.cloud import resourcemanager_v3

from app.config import settings

PermissionScope = Literal["project"]
PermissionStatusValue = Literal["GRANTED", "DENIED", "INVALID"]
LogCallback = Callable[[str], None]

DEFAULT_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "lb_permissions.yaml"
)


class PermissionStatus(str, Enum):
    GRANTED = "GRANTED"
    DENIED = "DENIED"
    INVALID = "INVALID"


@dataclass(frozen=True)
class PermissionEntry:
    permission: str
    scope: PermissionScope = "project"


@dataclass(frozen=True)
class PermissionCheckOutcome:
    permission: str
    status: PermissionStatus
    scope: PermissionScope
    resource: str


def load_permission_manifest(manifest_path: Path | None = None) -> list[PermissionEntry]:
    path = manifest_path or settings.permission_manifest_path or DEFAULT_MANIFEST_PATH
    if not path.exists():
        raise ValueError(f"Permission manifest not found: {path}")

    with path.open(encoding="utf-8") as manifest_file:
        data = yaml.safe_load(manifest_file)

    entries = data.get("permissions", [])
    if not entries:
        raise ValueError(f"Permission manifest is empty: {path}")

    manifest: list[PermissionEntry] = []
    for entry in entries:
        permission = entry.get("permission")
        if not permission:
            raise ValueError(f"Permission manifest entry missing 'permission': {entry}")

        scope = entry.get("scope", "project")
        if scope != "project":
            raise ValueError(
                f"Unsupported permission scope '{scope}' for {permission}. "
                "Only 'project' is supported."
            )

        manifest.append(PermissionEntry(permission=permission, scope=scope))

    return manifest


def build_resource_name(project_id: str, scope: PermissionScope) -> str:
    if scope == "project":
        return f"projects/{project_id}"

    raise ValueError(f"Unsupported resource scope: {scope}")


class PermissionPreflightChecker:
    def __init__(self, credentials) -> None:
        self._credentials = credentials
        self._client = resourcemanager_v3.ProjectsClient(credentials=credentials)

    def check_manifest(
        self,
        project_id: str,
        manifest: list[PermissionEntry],
        on_log: LogCallback | None = None,
    ) -> list[PermissionCheckOutcome]:
        outcomes: list[PermissionCheckOutcome] = []
        total = len(manifest)

        for index, entry in enumerate(manifest, start=1):
            resource = build_resource_name(project_id, entry.scope)
            self._emit_log(
                on_log,
                f"[{index}/{total}] Testing {entry.permission} on {resource}...",
            )
            status = self._test_permission(resource, entry.permission)
            self._emit_log(on_log, f"[{index}/{total}] {entry.permission} -> {status.value}")
            outcomes.append(
                PermissionCheckOutcome(
                    permission=entry.permission,
                    status=status,
                    scope=entry.scope,
                    resource=resource,
                )
            )

        return outcomes

    @staticmethod
    def _emit_log(on_log: LogCallback | None, message: str) -> None:
        if on_log is not None:
            timestamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
            on_log(f"{timestamp}  {message}")

    def _test_permission(self, resource: str, permission: str) -> PermissionStatus:
        try:
            response = self._client.test_iam_permissions(
                resource=resource,
                permissions=[permission],
            )
        except google_exceptions.InvalidArgument:
            return PermissionStatus.INVALID
        except google_exceptions.PermissionDenied:
            return PermissionStatus.DENIED
        except google_exceptions.NotFound:
            return PermissionStatus.INVALID
        except google_exceptions.GoogleAPIError:
            return PermissionStatus.INVALID

        if permission in response.permissions:
            return PermissionStatus.GRANTED

        return PermissionStatus.DENIED
