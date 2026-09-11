export const PERMISSION_WHY = {
  "resourcemanager.projects.get":
    "Required to verify access to the target GCP project before scanning.",
  "compute.forwardingRules.list":
    "Required to discover public external load balancer forwarding rules.",
  "compute.forwardingRules.get":
    "Required to read forwarding rule details including IP and target proxy.",
  "compute.targetHttpProxies.list":
    "Required to list HTTP target proxies attached to forwarding rules.",
  "compute.targetHttpProxies.get":
    "Required to resolve URL maps from HTTP target proxies.",
  "compute.targetHttpsProxies.list":
    "Required to list HTTPS target proxies attached to forwarding rules.",
  "compute.targetHttpsProxies.get":
    "Required to resolve URL maps from HTTPS target proxies.",
  "compute.urlMaps.list":
    "Required to discover URL maps that route traffic to backend services.",
  "compute.urlMaps.get":
    "Required to read URL map path rules and backend service references.",
  "compute.backendServices.list":
    "Required to list backend services behind each load balancer.",
  "compute.backendServices.get":
    "Required to inspect backend service Cloud Armor policy attachments.",
  "compute.securityPolicies.list":
    "Required to list Cloud Armor security policies in the project.",
  "compute.securityPolicies.get":
    "Required to verify Cloud Armor policy details attached to backends.",
};

export function permissionReason(permission) {
  return (
    PERMISSION_WHY[permission] ||
    "Required to discover and analyze load balancer resources in this project."
  );
}
