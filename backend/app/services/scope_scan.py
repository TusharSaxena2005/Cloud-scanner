from collections.abc import Callable

from app.models.schemas import ScanResponse
from app.services.external_lb_scanner import ExternalLbScanner
from app.services.lb_permission_checker import LbPermissionChecker
from app.services.scan_orchestrator import _hierarchy_to_response, _resource_node_to_response
from app.services.scope_project_discovery import ScopeProjectDiscovery

LogCallback = Callable[[str], None]


class ScopeScanOrchestrator:
    def __init__(self, credentials, principal_email: str) -> None:
        self._credentials = credentials
        self._principal_email = principal_email

    def run(
        self,
        scope_type: str,
        scope_id: str,
        on_log: LogCallback | None = None,
    ) -> ScanResponse:
        logs: list[str] = []

        def emit(message: str) -> None:
            logs.append(message)
            if on_log is not None:
                on_log(message)

        emit(f"Discovering projects under {scope_type} '{scope_id}'")
        discovery = ScopeProjectDiscovery(self._credentials).discover(
            scope_type,
            scope_id,
            on_log=emit,
        )
        project_ids = discovery.project_ids
        if not project_ids:
            return ScanResponse(
                project_id=scope_id,
                scope_type=scope_type,
                scope_id=scope_id,
                status="completed",
                message="No projects were found in this scope.",
                service_account_email=self._principal_email,
                project_ids=[],
                skipped_scopes=discovery.skipped_scopes,
                logs=logs,
            )

        emit(f"Checking scan permissions for all {len(project_ids)} discovered project(s)")
        accessible_project_ids: list[str] = []
        skipped_projects = []
        for index, project_id in enumerate(project_ids, start=1):
            emit(f"[{index}/{len(project_ids)}] Checking project '{project_id}'")
            try:
                result = LbPermissionChecker(
                    self._credentials,
                    self._principal_email,
                ).check(project_id, on_log=emit)
            except Exception as exc:
                skipped_projects.append({"project_id": project_id, "reason": str(exc)})
                emit(f"Skipping project '{project_id}': permission check failed: {exc}")
                continue
            if result.all_permissions_granted:
                accessible_project_ids.append(project_id)
            else:
                missing = result.missing_permissions + result.invalid_permissions
                reason = "Missing required permissions: " + ", ".join(missing)
                skipped_projects.append({"project_id": project_id, "reason": reason})
                emit(f"Skipping project '{project_id}': {reason}")

        if not accessible_project_ids:
            return ScanResponse(
                project_id=scope_id,
                scope_type=scope_type,
                scope_id=scope_id,
                status="blocked",
                message=f"No projects in this scope have all required scan permissions ({len(project_ids)} checked).",
                service_account_email=self._principal_email,
                project_ids=project_ids,
                scanned_project_ids=[],
                skipped_projects=skipped_projects,
                skipped_scopes=discovery.skipped_scopes,
                logs=logs,
            )

        emit(
            f"All projects are discovered. Listing forwarding rules across "
            f"{len(accessible_project_ids)} accessible project(s) before resolving resource details."
        )
        result = ExternalLbScanner(self._credentials).scan_projects(
            accessible_project_ids,
            on_log=emit,
            continue_on_project_error=True,
        )
        skipped_projects.extend(result.failed_projects)
        failed_project_ids = {item["project_id"] for item in result.failed_projects}
        scanned_project_ids = [
            project_id
            for project_id in accessible_project_ids
            if project_id not in failed_project_ids
        ]
        successful_projects = len(scanned_project_ids)
        status = "failed" if successful_projects == 0 else "completed"
        message = (
            f"Scanned {successful_projects} of {len(project_ids)} project(s). "
            f"Discovered {len(result.load_balancers)} public external load balancer(s); "
            f"{len(skipped_projects) + len(discovery.skipped_scopes)} resource(s) or scope(s) skipped."
        )
        emit(message)

        return ScanResponse(
            project_id=scope_id,
            scope_type=scope_type,
            scope_id=scope_id,
            status=status,
            message=message,
            service_account_email=self._principal_email,
            projects=[
                _resource_node_to_response(project)
                for project in result.projects
                if project is not None
            ],
            project_ids=project_ids,
            scanned_project_ids=scanned_project_ids,
            skipped_projects=skipped_projects,
            skipped_scopes=discovery.skipped_scopes,
            load_balancers=[
                _hierarchy_to_response(item) for item in result.load_balancers
            ],
            logs=logs,
        )
