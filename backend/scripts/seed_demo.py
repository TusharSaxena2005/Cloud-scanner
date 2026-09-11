"""Seed a new isolated demo account; never modify an existing account."""
from datetime import datetime, timezone
import secrets
from app.auth import database, password_hash


def sample_workspace(project="demo-cloud-armor"):
    def node(kind, name, **details):
        return {"resource_type": kind, "name": name, "scope": "global", "details": details,
                "self_link": f"https://www.googleapis.com/compute/v1/projects/{project}/global/{kind}/{name}"}
    def lb(name, ip, backends):
        return {"forwarding_rule": node("forwardingRules", name, ip_address=ip, port_range="443", load_balancing_scheme="EXTERNAL_MANAGED"),
                "target_proxy": node("targetHttpsProxies", name + "-proxy"),
                "url_map": node("urlMaps", name + "-routes"),
                "backend_services": [{"backend_service": node("backendServices", backend, protocol="HTTPS", timeout_sec=30),
                                      "security_policy": node("securityPolicies", policy) if policy else None}
                                     for backend, policy in backends], "warnings": []}
    load_balancers = [lb("web-production-lb", "192.0.2.10", [("web-frontend", "web-waf-policy"), ("checkout-api", "api-rate-limit-policy")]),
                      lb("public-api-lb", "192.0.2.20", [("catalog-api", "api-waf-policy"), ("legacy-api", None)]),
                      lb("staging-lb", "192.0.2.30", [("staging-web", None), ("preview-service", None)])]
    if project == "demo-commerce-platform":
        load_balancers = [lb("commerce-storefront-lb", "198.51.100.10", [("product-storefront", "commerce-waf"), ("payment-api", "payments-waf")]),
                          lb("commerce-partners-lb", "198.51.100.20", [("partner-api", "partner-rate-limit"), ("legacy-webhooks", None)])]
    now = datetime.now(timezone.utc).isoformat()
    return {"sampleMode": True, "scopeType": "project", "scopeId": project,
            "serviceAccount": {"email": "demo-scanner@example.com"}, "preflight": None,
            "scanStatus": "completed", "lastScanTime": now, "scanDurationMs": 12400,
            "scanLogs": "Sample dataset loaded. No Google Cloud requests were made.\n",
            "scanResult": {"project_id": project, "status": "completed", "message": f"Sample scan: {len(load_balancers)} load balancers, {sum(len(lb['backend_services']) for lb in load_balancers)} backends", "lastScanTime": now,
                           "load_balancers": load_balancers}}


if __name__ == "__main__":
    db = database()
    email = "demo@example.com"
    if db.users.find_one({"email": email}):
        raise SystemExit("Demo email already exists; left the existing account unchanged.")
    password = secrets.token_urlsafe(16)
    db.users.insert_one({"name": "Demo Workspace", "email": email, "password_hash": password_hash(password),
                         "created_at": datetime.now(timezone.utc), "is_demo": True, "sample_workspace": {**sample_workspace(), "projects": [sample_workspace(), sample_workspace("demo-commerce-platform")]}})
    print("Demo account created.")
    print("Email: " + email)
    print("Password: " + password)
