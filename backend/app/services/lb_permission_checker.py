from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.services.gcp_credentials import (
    load_scanner_credentials,
    resolve_credentials_identity,
)
from app.services.permission_preflight import (
    LogCallback,
    PermissionPreflightChecker,
    PermissionStatus,
    load_permission_manifest,
)


@dataclass
class LbPermissionCheckResult:
    project_id: str
    service_account_email: str
    all_permissions_granted: bool
    permissions: list[dict[str, str]]
    missing_permissions: list[str]
    invalid_permissions: list[str]
    message: str
    logs: list[str] = field(default_factory=list)


class LbPermissionChecker:
    def __init__(self) -> None:
        self._credentials = load_scanner_credentials()
        self._service_account_email, _ = resolve_credentials_identity(self._credentials)
        self._manifest = load_permission_manifest()

    def check(
        self,
        project_id: str,
        on_log: LogCallback | None = None,
    ) -> LbPermissionCheckResult:
        logs: list[str] = []

        def emit(message: str) -> None:
            timestamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
            line = f"{timestamp}  {message}"
            logs.append(line)
            if on_log is not None:
                on_log(line)

        emit(f"Starting permission preflight for project '{project_id}'")
        emit(f"Using identity: {self._service_account_email}")
        emit(f"Loaded permission manifest ({len(self._manifest)} permissions)")

        preflight_checker = PermissionPreflightChecker(self._credentials)
        outcomes = preflight_checker.check_manifest(
            project_id,
            self._manifest,
            on_log=lambda message: self._append_preflight_log(logs, on_log, message),
        )

        permission_results = [
            {
                "permission": outcome.permission,
                "status": outcome.status.value,
                "scope": outcome.scope,
                "resource": outcome.resource,
            }
            for outcome in outcomes
        ]

        missing_permissions = [
            outcome.permission
            for outcome in outcomes
            if outcome.status == PermissionStatus.DENIED
        ]
        invalid_permissions = [
            outcome.permission
            for outcome in outcomes
            if outcome.status == PermissionStatus.INVALID
        ]

        all_permissions_granted = not missing_permissions and not invalid_permissions
        emit("Preflight check complete")

        message = self._build_message(
            all_permissions_granted=all_permissions_granted,
            missing_permissions=missing_permissions,
            invalid_permissions=invalid_permissions,
        )

        if not all_permissions_granted:
            not_granted = missing_permissions + invalid_permissions
            emit(f"Missing permissions: {', '.join(not_granted)}")

        return LbPermissionCheckResult(
            project_id=project_id,
            service_account_email=self._service_account_email,
            all_permissions_granted=all_permissions_granted,
            permissions=permission_results,
            missing_permissions=missing_permissions,
            invalid_permissions=invalid_permissions,
            message=message,
            logs=logs,
        )

    @staticmethod
    def _append_preflight_log(
        logs: list[str],
        on_log: LogCallback | None,
        message: str,
    ) -> None:
        logs.append(message)
        if on_log is not None:
            on_log(message)

    @staticmethod
    def _build_message(
        *,
        all_permissions_granted: bool,
        missing_permissions: list[str],
        invalid_permissions: list[str],
    ) -> str:
        if all_permissions_granted:
            return "All required permissions are granted."

        not_granted = missing_permissions + invalid_permissions
        return "Missing permissions: " + ", ".join(not_granted)
