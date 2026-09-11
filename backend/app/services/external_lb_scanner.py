from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone

from google.api_core import exceptions as google_exceptions
from google.cloud import compute_v1, resourcemanager_v3

from app.services.gcp_credentials import load_scanner_credentials
from app.services.gcp_resource_utils import parse_gcp_self_link, resource_scope_label

LogCallback = Callable[[str], None]

EXTERNAL_LB_SCHEMES = {"EXTERNAL", "EXTERNAL_MANAGED"}
HTTP_PROXY_TYPES = ("targetHttpProxies", "targetHttpsProxies")
INTERNAL_LB_SCHEMES = {"INTERNAL", "INTERNAL_MANAGED", "INTERNAL_SELF_MANAGED"}


@dataclass
class ResourceNode:
    resource_type: str
    name: str
    scope: str
    self_link: str | None = None
    details: dict[str, object] = field(default_factory=dict)
    error: str | None = None


@dataclass
class BackendServiceNode:
    backend_service: ResourceNode
    security_policy: ResourceNode | None = None


@dataclass
class LoadBalancerHierarchy:
    forwarding_rule: ResourceNode
    target_proxy: ResourceNode | None = None
    url_map: ResourceNode | None = None
    backend_services: list[BackendServiceNode] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ScanResult:
    project_id: str
    project: ResourceNode | None
    load_balancers: list[LoadBalancerHierarchy]
    logs: list[str] = field(default_factory=list)


class ExternalLbScanner:
    def __init__(self) -> None:
        self._credentials = load_scanner_credentials()
        self._logs: list[str] = []

    def scan(self, project_id: str, on_log: LogCallback | None = None) -> ScanResult:
        self._logs = []
        self._on_log = on_log

        self._log(f"Starting external load balancer discovery for project '{project_id}'")
        project = self._get_project(project_id)

        forwarding_rules = self._discover_external_forwarding_rules(project_id)
        self._log(f"Found {len(forwarding_rules)} public external forwarding rule(s)")

        hierarchies: list[LoadBalancerHierarchy] = []
        for index, rule in enumerate(forwarding_rules, start=1):
            self._log(
                f"[{index}/{len(forwarding_rules)}] Building hierarchy for forwarding rule '{rule.name}'"
            )
            hierarchies.append(self._build_hierarchy(project_id, rule))

        self._log("Resource discovery complete")
        return ScanResult(
            project_id=project_id,
            project=project,
            load_balancers=hierarchies,
            logs=self._logs,
        )

    def _log(self, message: str) -> None:
        timestamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        line = f"{timestamp}  {message}"
        self._logs.append(line)
        if self._on_log is not None:
            self._on_log(line)

    def _get_project(self, project_id: str) -> ResourceNode | None:
        self._log(f"Fetching project resource '{project_id}'")
        client = resourcemanager_v3.ProjectsClient(credentials=self._credentials)
        try:
            project = client.get_project(name=f"projects/{project_id}")
            return ResourceNode(
                resource_type="project",
                name=project_id,
                scope="project",
                self_link=project.name,
                details={
                    "project_id": project_id,
                    "display_name": project.display_name,
                    "state": project.state.name if project.state else None,
                },
            )
        except google_exceptions.GoogleAPIError as exc:
            self._log(f"Failed to fetch project '{project_id}': {exc}")
            return ResourceNode(
                resource_type="project",
                name=project_id,
                scope="project",
                error=str(exc),
            )

    def _discover_external_forwarding_rules(
        self, project_id: str
    ) -> list[compute_v1.ForwardingRule]:
        rules: list[compute_v1.ForwardingRule] = []

        self._log("Listing global forwarding rules")
        global_client = compute_v1.GlobalForwardingRulesClient(
            credentials=self._credentials
        )
        global_request = compute_v1.ListGlobalForwardingRulesRequest(project=project_id)
        global_total = 0
        for rule in global_client.list(request=global_request):
            global_total += 1
            matched, reason = self._match_public_external_rule(rule)
            if matched:
                rules.append(rule)
                self._log(f"Matched global forwarding rule '{rule.name}'")
            else:
                self._log(
                    f"Skipped global forwarding rule '{rule.name}': {reason}"
                )

        self._log(
            f"Global forwarding rules: {global_total} listed, {len(rules)} matched so far"
        )

        self._log("Listing regional forwarding rules")
        regions_client = compute_v1.RegionsClient(credentials=self._credentials)
        regions_request = compute_v1.ListRegionsRequest(project=project_id)
        regions = [region.name for region in regions_client.list(request=regions_request)]
        self._log(f"Scanning {len(regions)} region(s) for forwarding rules")

        regional_total = 0
        regional_matched = 0
        def list_regional_rules(region_name: str) -> tuple[str, list[compute_v1.ForwardingRule]]:
            client = compute_v1.ForwardingRulesClient(credentials=self._credentials)
            regional_request = compute_v1.ListForwardingRulesRequest(
                project=project_id,
                region=region_name,
            )
            return region_name, list(client.list(request=regional_request))

        completed_regions = 0
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {
                executor.submit(list_regional_rules, region): region for region in regions
            }
            for future in as_completed(futures):
                region_name = futures[future]
                completed_regions += 1
                try:
                    _, regional_rules = future.result()
                except google_exceptions.GoogleAPIError as exc:
                    self._log(f"Failed to list forwarding rules in '{region_name}': {exc}")
                    continue

                if regional_rules:
                    self._log(
                        f"Region '{region_name}': found {len(regional_rules)} forwarding rule(s) "
                        f"({completed_regions}/{len(regions)} regions checked)"
                    )

                for rule in regional_rules:
                    regional_total += 1
                    matched, reason = self._match_public_external_rule(rule)
                    if matched:
                        rules.append(rule)
                        regional_matched += 1
                        self._log(f"Matched regional forwarding rule '{rule.name}' ({region_name})")
                    elif rule.load_balancing_scheme or rule.target:
                        self._log(
                            f"Skipped regional forwarding rule '{rule.name}' ({region_name}): {reason}"
                        )

        self._log(
            f"Regional forwarding rules: {regional_total} listed, {regional_matched} matched"
        )
        return rules

    @staticmethod
    def _match_public_external_rule(
        rule: compute_v1.ForwardingRule,
    ) -> tuple[bool, str]:
        scheme = (rule.load_balancing_scheme or "").upper()
        if scheme in INTERNAL_LB_SCHEMES:
            return False, f"internal scheme '{scheme}'"
        if scheme not in EXTERNAL_LB_SCHEMES:
            return False, f"unsupported scheme '{scheme or 'unknown'}'"

        target = rule.target or ""
        if not any(proxy_type in target for proxy_type in HTTP_PROXY_TYPES):
            return False, "target is not an HTTP/HTTPS proxy"

        return True, ""

    def _build_hierarchy(
        self,
        project_id: str,
        rule: compute_v1.ForwardingRule,
    ) -> LoadBalancerHierarchy:
        scope = "global" if "/global/" in (rule.self_link or "") else self._region_from_self_link(
            rule.self_link
        )
        hierarchy = LoadBalancerHierarchy(
            forwarding_rule=ResourceNode(
                resource_type="forwardingRule",
                name=rule.name or "",
                scope=scope or "unknown",
                self_link=rule.self_link,
                details={
                    "ip_address": getattr(rule, "IPAddress", None)
                    or getattr(rule, "ip_address", None),
                    "load_balancing_scheme": rule.load_balancing_scheme,
                    "port_range": rule.port_range,
                    "target": rule.target,
                },
            )
        )

        if not rule.target:
            hierarchy.warnings.append("Forwarding rule has no target proxy")
            return hierarchy

        target_proxy = self._resolve_target_proxy(rule.target)
        hierarchy.target_proxy = target_proxy
        if target_proxy.error or not target_proxy.details.get("url_map"):
            hierarchy.warnings.append("Could not resolve URL map from target proxy")
            return hierarchy

        url_map_link = str(target_proxy.details["url_map"])
        url_map = self._resolve_url_map(url_map_link)
        hierarchy.url_map = url_map
        if url_map.error:
            hierarchy.warnings.append(f"URL map resolution failed: {url_map.error}")
            return hierarchy

        backend_links = self._extract_backend_service_links(url_map.details)
        if not backend_links:
            hierarchy.warnings.append("No backend services referenced by URL map")

        for backend_link in backend_links:
            backend_node = self._resolve_backend_service(backend_link)
            security_policy_node = None
            security_policy_link = backend_node.details.get("security_policy")
            if security_policy_link:
                security_policy_node = self._resolve_security_policy(
                    str(security_policy_link)
                )
            else:
                self._log(
                    f"No Cloud Armor policy attached to backend service '{backend_node.name}'"
                )

            hierarchy.backend_services.append(
                BackendServiceNode(
                    backend_service=backend_node,
                    security_policy=security_policy_node,
                )
            )

        return hierarchy

    def _resolve_target_proxy(self, target_link: str) -> ResourceNode:
        ref = parse_gcp_self_link(target_link)
        if ref is None:
            return ResourceNode(
                resource_type="targetProxy",
                name="unknown",
                scope="unknown",
                self_link=target_link,
                error=f"Unable to parse target proxy link: {target_link}",
            )

        self._log(
            f"Resolving target proxy '{ref.name}' ({ref.resource_type}, {resource_scope_label(ref.region)})"
        )

        try:
            if ref.resource_type == "targetHttpProxies":
                if ref.region:
                    client = compute_v1.RegionTargetHttpProxiesClient(
                        credentials=self._credentials
                    )
                    request = compute_v1.GetRegionTargetHttpProxyRequest(
                        project=ref.project,
                        region=ref.region,
                        target_http_proxy=ref.name,
                    )
                    proxy = client.get(request=request)
                else:
                    client = compute_v1.TargetHttpProxiesClient(
                        credentials=self._credentials
                    )
                    request = compute_v1.GetTargetHttpProxyRequest(
                        project=ref.project,
                        target_http_proxy=ref.name,
                    )
                    proxy = client.get(request=request)
            elif ref.resource_type == "targetHttpsProxies":
                if ref.region:
                    client = compute_v1.RegionTargetHttpsProxiesClient(
                        credentials=self._credentials
                    )
                    request = compute_v1.GetRegionTargetHttpsProxyRequest(
                        project=ref.project,
                        region=ref.region,
                        target_https_proxy=ref.name,
                    )
                    proxy = client.get(request=request)
                else:
                    client = compute_v1.TargetHttpsProxiesClient(
                        credentials=self._credentials
                    )
                    request = compute_v1.GetTargetHttpsProxyRequest(
                        project=ref.project,
                        target_https_proxy=ref.name,
                    )
                    proxy = client.get(request=request)
            else:
                return ResourceNode(
                    resource_type=ref.resource_type,
                    name=ref.name,
                    scope=resource_scope_label(ref.region),
                    self_link=target_link,
                    error=f"Unsupported target proxy type: {ref.resource_type}",
                )
        except google_exceptions.GoogleAPIError as exc:
            return ResourceNode(
                resource_type=ref.resource_type,
                name=ref.name,
                scope=resource_scope_label(ref.region),
                self_link=target_link,
                error=str(exc),
            )

        return ResourceNode(
            resource_type=ref.resource_type,
            name=ref.name,
            scope=resource_scope_label(ref.region),
            self_link=proxy.self_link,
            details={
                "url_map": proxy.url_map,
                "proxy_bind": getattr(proxy, "proxy_bind", None),
            },
        )

    def _resolve_url_map(self, url_map_link: str) -> ResourceNode:
        ref = parse_gcp_self_link(url_map_link)
        if ref is None:
            return ResourceNode(
                resource_type="urlMap",
                name="unknown",
                scope="unknown",
                self_link=url_map_link,
                error=f"Unable to parse URL map link: {url_map_link}",
            )

        self._log(
            f"Resolving URL map '{ref.name}' ({resource_scope_label(ref.region)})"
        )

        try:
            if ref.region:
                client = compute_v1.RegionUrlMapsClient(credentials=self._credentials)
                request = compute_v1.GetRegionUrlMapRequest(
                    project=ref.project,
                    region=ref.region,
                    url_map=ref.name,
                )
                url_map = client.get(request=request)
            else:
                client = compute_v1.UrlMapsClient(credentials=self._credentials)
                request = compute_v1.GetUrlMapRequest(
                    project=ref.project,
                    url_map=ref.name,
                )
                url_map = client.get(request=request)
        except google_exceptions.GoogleAPIError as exc:
            return ResourceNode(
                resource_type="urlMap",
                name=ref.name,
                scope=resource_scope_label(ref.region),
                self_link=url_map_link,
                error=str(exc),
            )

        return ResourceNode(
            resource_type="urlMap",
            name=ref.name,
            scope=resource_scope_label(ref.region),
            self_link=url_map.self_link,
            details=self._serialize_url_map(url_map),
        )

    def _resolve_backend_service(self, backend_link: str) -> ResourceNode:
        ref = parse_gcp_self_link(backend_link)
        if ref is None:
            return ResourceNode(
                resource_type="backendService",
                name="unknown",
                scope="unknown",
                self_link=backend_link,
                error=f"Unable to parse backend service link: {backend_link}",
            )

        self._log(
            f"Resolving backend service '{ref.name}' ({resource_scope_label(ref.region)})"
        )

        try:
            if ref.region:
                client = compute_v1.RegionBackendServicesClient(
                    credentials=self._credentials
                )
                request = compute_v1.GetRegionBackendServiceRequest(
                    project=ref.project,
                    region=ref.region,
                    backend_service=ref.name,
                )
                backend = client.get(request=request)
            else:
                client = compute_v1.BackendServicesClient(credentials=self._credentials)
                request = compute_v1.GetBackendServiceRequest(
                    project=ref.project,
                    backend_service=ref.name,
                )
                backend = client.get(request=request)
        except google_exceptions.GoogleAPIError as exc:
            return ResourceNode(
                resource_type="backendService",
                name=ref.name,
                scope=resource_scope_label(ref.region),
                self_link=backend_link,
                error=str(exc),
            )

        return ResourceNode(
            resource_type="backendService",
            name=ref.name,
            scope=resource_scope_label(ref.region),
            self_link=backend.self_link,
            details={
                "protocol": backend.protocol,
                "load_balancing_scheme": backend.load_balancing_scheme,
                "security_policy": backend.security_policy or None,
                "backends": [
                    {
                        "group": backend_ref.group,
                        "balancing_mode": backend_ref.balancing_mode,
                    }
                    for backend_ref in backend.backends
                ],
            },
        )

    def _resolve_security_policy(self, policy_link: str) -> ResourceNode:
        ref = parse_gcp_self_link(policy_link)
        if ref is None:
            return ResourceNode(
                resource_type="securityPolicy",
                name="unknown",
                scope="unknown",
                self_link=policy_link,
                error=f"Unable to parse security policy link: {policy_link}",
            )

        self._log(
            f"Resolving Cloud Armor policy '{ref.name}' ({resource_scope_label(ref.region)})"
        )

        try:
            if ref.region:
                client = compute_v1.RegionSecurityPoliciesClient(
                    credentials=self._credentials
                )
                request = compute_v1.GetRegionSecurityPolicyRequest(
                    project=ref.project,
                    region=ref.region,
                    security_policy=ref.name,
                )
                policy = client.get(request=request)
            else:
                client = compute_v1.SecurityPoliciesClient(credentials=self._credentials)
                request = compute_v1.GetSecurityPolicyRequest(
                    project=ref.project,
                    security_policy=ref.name,
                )
                policy = client.get(request=request)
        except google_exceptions.GoogleAPIError as exc:
            return ResourceNode(
                resource_type="securityPolicy",
                name=ref.name,
                scope=resource_scope_label(ref.region),
                self_link=policy_link,
                error=str(exc),
            )

        return ResourceNode(
            resource_type="securityPolicy",
            name=ref.name,
            scope=resource_scope_label(ref.region),
            self_link=policy.self_link,
            details={
                "description": policy.description,
                "type": policy.type_,
                "rule_count": len(policy.rules),
            },
        )

    @staticmethod
    def _serialize_url_map(url_map: compute_v1.UrlMap) -> dict[str, object]:
        path_matchers = []
        for matcher in url_map.path_matchers:
            path_rules = [
                {
                    "paths": list(path_rule.paths),
                    "service": path_rule.service,
                }
                for path_rule in matcher.path_rules
            ]
            path_matchers.append(
                {
                    "name": matcher.name,
                    "default_service": matcher.default_service,
                    "path_rules": path_rules,
                }
            )

        return {
            "default_service": url_map.default_service,
            "host_rules": [
                {
                    "hosts": list(host_rule.hosts),
                    "path_matcher": host_rule.path_matcher,
                }
                for host_rule in url_map.host_rules
            ],
            "path_matchers": path_matchers,
        }

    @staticmethod
    def _extract_backend_service_links(url_map_details: dict[str, object]) -> list[str]:
        links: set[str] = set()

        default_service = url_map_details.get("default_service")
        if default_service:
            links.add(str(default_service))

        for matcher in url_map_details.get("path_matchers", []):
            if not isinstance(matcher, dict):
                continue
            matcher_default = matcher.get("default_service")
            if matcher_default:
                links.add(str(matcher_default))
            for path_rule in matcher.get("path_rules", []):
                if isinstance(path_rule, dict) and path_rule.get("service"):
                    links.add(str(path_rule["service"]))

        return sorted(links)

    @staticmethod
    def _region_from_self_link(self_link: str | None) -> str | None:
        ref = parse_gcp_self_link(self_link or "")
        return ref.region if ref else None
