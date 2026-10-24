"""Convert the bundled synthetic organization inventory into demo workspaces."""
import json
import re
from functools import lru_cache
from pathlib import Path


def snake_case(key):
    return re.sub(r"(?<!^)(?=[A-Z][a-z])|(?<=[a-z0-9])(?=[A-Z])", "_", key).lower()


def resource_node(resource, kind):
    return {"resource_type": kind, "name": resource["name"], "scope": "global",
            "self_link": resource["selfLink"], "raw": resource,
            "details": {snake_case(k): v for k, v in resource.items() if k not in {"name", "selfLink", "kind"}}}


def project_workspace(snapshot):
    project = snapshot["project"]["projectId"]
    def index(key):
        return {item["selfLink"]: item for item in snapshot[key]}
    proxies = index("globalTargetHttpsProxies")
    maps = index("globalUrlMaps")
    backends = index("globalBackendServices")
    policies = index("globalSecurityPolicies")
    names = {rule: lb["name"] for lb in snapshot["loadBalancers"] for rule in lb["forwardingRuleNames"]}
    load_balancers = []
    for rule in snapshot["globalForwardingRules"]:
        proxy = proxies[rule["target"]]
        url_map = maps[proxy["urlMap"]]
        # Walk all route branches; a backend shared by routes appears once per LB.
        links = []
        def collect(value):
            if isinstance(value, dict):
                for child in value.values():
                    collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)
            elif isinstance(value, str) and value in backends and value not in links:
                links.append(value)
        collect(url_map)
        entries = []
        for link in links:
            backend = backends[link]
            policy = policies.get(backend.get("securityPolicy"))
            edge = policies.get(backend.get("edgeSecurityPolicy"))
            entries.append({"backend_service": resource_node(backend, "backendServices"),
                            "security_policy": resource_node(policy, "securityPolicies") if policy else None,
                            "edge_security_policy": resource_node(edge, "securityPolicies") if edge else None})
        load_balancers.append({"name": names[rule["name"]],
                              "forwarding_rule": resource_node(rule, "forwardingRules"),
                              "target_proxy": resource_node(proxy, "targetHttpsProxies"),
                              "url_map": resource_node(url_map, "urlMaps"),
                              "backend_services": entries, "warnings": []})
    workspace = {"sampleMode": True, "scopeType": "project", "scopeId": project,
                 "serviceAccount": {"email": "demo-scanner@example.com"}, "preflight": None,
                 "scanStatus": "completed", "lastScanTime": None, "scanDurationMs": None,
                 "scanLogs": "Synthetic snapshot loaded. No Google Cloud requests were made.\n",
                 "scanResult": {"project_id": project, "status": "completed",
                                "message": f"Sample scan: {len(load_balancers)} load balancers, {sum(len(lb['backend_services']) for lb in load_balancers)} backends",
                                "load_balancers": load_balancers}}
    return workspace


@lru_cache
def sample_workspace():
    inventory = json.loads((Path(__file__).parent / "data" / "demo_snapshot.json").read_text(encoding="utf-8"))
    projects = [project_workspace(snapshot) for snapshot in inventory["projects"]]
    load_balancers = [{**lb, "project_id": project["scopeId"]}
                      for project in projects for lb in project["scanResult"]["load_balancers"]]
    return {**projects[0], "scopeId": "all-projects", "organizationId": inventory["organizationId"],
            "projects": projects,
            "scanResult": {"project_id": "all-projects", "status": "completed",
                           "message": f"Sample data across {len(projects)} projects",
                           "load_balancers": load_balancers}}


