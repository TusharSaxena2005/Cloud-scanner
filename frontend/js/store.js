const STORAGE_KEY = "cloud-armor-scanner-state";

const defaultState = {
  scopeType: "project",
  scopeId: "",
  serviceAccount: null,
  preflight: null,
  scanResult: null,
  lastScanTime: null,
  scanDurationMs: null,
  scanStatus: "idle",
  activeScanStep: 0,
  scanLogs: "",
};

let state = loadState();
const listeners = new Set();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultState, ...JSON.parse(raw) } : { ...defaultState };
  } catch {
    return { ...defaultState };
  }
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      scopeType: state.scopeType,
      scopeId: state.scopeId,
      serviceAccount: state.serviceAccount,
      preflight: state.preflight,
      scanResult: state.scanResult,
      lastScanTime: state.lastScanTime,
      scanDurationMs: state.scanDurationMs,
      scanStatus: state.scanStatus,
      activeScanStep: state.activeScanStep,
      scanLogs: state.scanLogs,
    })
  );
}

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function patchState(partial) {
  state = { ...state, ...partial };
  persist();
  listeners.forEach((listener) => listener(state));
}

export function flattenBackends(scanResult) {
  if (!scanResult?.load_balancers) return [];

  const rows = [];
  const projectId = scanResult.project_id;

  for (const lb of scanResult.load_balancers) {
    const lbName = lb.forwarding_rule?.name || "unknown-lb";
    const forwardingRule = lb.forwarding_rule?.name || "—";

    if (!lb.backend_services?.length) {
      rows.push({
        project: projectId,
        loadBalancer: lbName,
        forwardingRule,
        backendService: "—",
        cloudArmorPolicy: "No Policy",
        status: "UNPROTECTED",
        lastDetected: scanResult.lastScanTime || new Date().toISOString(),
        hierarchy: lb,
        backendNode: null,
      });
      continue;
    }

    for (const entry of lb.backend_services) {
      const backend = entry.backend_service;
      const policy = entry.security_policy;
      const hasPolicy = policy && !policy.error && policy.name;

      rows.push({
        project: projectId,
        loadBalancer: lbName,
        forwardingRule,
        backendService: backend?.name || "unknown",
        cloudArmorPolicy: hasPolicy ? policy.name : "No Policy",
        status: hasPolicy ? "PROTECTED" : "UNPROTECTED",
        lastDetected: scanResult.lastScanTime || new Date().toISOString(),
        hierarchy: lb,
        backendNode: entry,
      });
    }
  }

  return rows;
}

export function scanSummary(scanResult) {
  const backends = flattenBackends({
    ...scanResult,
    lastScanTime: getState().lastScanTime,
  });
  const protectedCount = backends.filter((b) => b.status === "PROTECTED").length;
  return {
    loadBalancers: scanResult?.load_balancers?.length || 0,
    backendServices: backends.filter((b) => b.backendService !== "—").length,
    protectedBackends: protectedCount,
    unprotectedBackends: backends.length - protectedCount,
    totalPublicBackends: backends.length,
  };
}
