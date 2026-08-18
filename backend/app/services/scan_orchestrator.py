from app.models.schemas import (
    BackendServiceHierarchyResponse,
    CheckLbPermissionsResponse,
    LoadBalancerHierarchyResponse,
    PermissionCheckResult,
    ResourceNodeResponse,
    ScanResponse,
)
from app.services.external_lb_scanner import (
    ExternalLbScanner,
    LoadBalancerHierarchy,
    ResourceNode,
    ScanResult,
)
from app.services.lb_permission_checker import LbPermissionChecker, LbPermissionCheckResult


def build_preflight_response(
    result: LbPermissionCheckResult,
    logs: list[str] | None = None,
) -> CheckLbPermissionsResponse:
    return CheckLbPermissionsResponse(
        project_id=result.project_id,
        service_account_email=result.service_account_email,
        all_permissions_granted=result.all_permissions_granted,
        permissions=[
            PermissionCheckResult(
                permission=item["permission"],
                status=item["status"],
                scope=item["scope"],
                resource=item["resource"],
            )
            for item in result.permissions
        ],
        missing_permissions=result.missing_permissions,
        invalid_permissions=result.invalid_permissions,
        message=result.message,
        logs=logs if logs is not None else result.logs,
    )


def _resource_node_to_response(node: ResourceNode | None) -> ResourceNodeResponse | None:
    if node is None:
        return None
    return ResourceNodeResponse(
        resource_type=node.resource_type,
        name=node.name,
        scope=node.scope,
        self_link=node.self_link,
        details=node.details,
        error=node.error,
    )


def _hierarchy_to_response(hierarchy: LoadBalancerHierarchy) -> LoadBalancerHierarchyResponse:
    forwarding_rule = _resource_node_to_response(hierarchy.forwarding_rule)
    if forwarding_rule is None:
        raise ValueError("Load balancer hierarchy must include a forwarding rule")

    return LoadBalancerHierarchyResponse(
        forwarding_rule=forwarding_rule,
        target_proxy=_resource_node_to_response(hierarchy.target_proxy),
        url_map=_resource_node_to_response(hierarchy.url_map),
        backend_services=[
            BackendServiceHierarchyResponse(
                backend_service=_resource_node_to_response(item.backend_service),
                security_policy=_resource_node_to_response(item.security_policy),
            )
            for item in hierarchy.backend_services
            if _resource_node_to_response(item.backend_service) is not None
        ],
        warnings=hierarchy.warnings,
    )


class ScanOrchestrator:
    def run(self, project_id: str) -> ScanResponse:
        logs: list[str] = []

        def emit(message: str) -> None:
            logs.append(message)

        permission_checker = LbPermissionChecker()
        preflight_result = permission_checker.check(project_id, on_log=emit)
        preflight_response = build_preflight_response(preflight_result, logs=logs)

        if not preflight_result.all_permissions_granted:
            not_granted = (
                preflight_result.missing_permissions + preflight_result.invalid_permissions
            )
            message = "Missing permissions: " + ", ".join(not_granted)
            if message not in logs:
                emit(message)
            return ScanResponse(
                project_id=project_id,
                status="blocked",
                message=message,
                service_account_email=preflight_result.service_account_email,
                preflight=preflight_response,
                logs=logs,
            )

        emit("All permission granted. Now running the scanner.")

        try:
            scanner = ExternalLbScanner()
            scan_result = scanner.scan(project_id, on_log=emit)
        except Exception as exc:
            message = f"Scanner failed: {exc}"
            emit(message)
            return ScanResponse(
                project_id=project_id,
                status="failed",
                message=message,
                service_account_email=preflight_result.service_account_email,
                preflight=preflight_response,
                logs=logs,
            )

        message = (
            f"Scan completed. Discovered {len(scan_result.load_balancers)} "
            "public external load balancer(s)."
        )
        emit(message)

        return ScanResponse(
            project_id=project_id,
            status="completed",
            message=message,
            service_account_email=preflight_result.service_account_email,
            preflight=preflight_response,
            project=_resource_node_to_response(scan_result.project),
            load_balancers=[
                _hierarchy_to_response(item) for item in scan_result.load_balancers
            ],
            logs=logs,
        )
