const STORAGE_PREFIX = "cloud-armor-scanner-state";

const defaultState = {
  scopeType: "project",
  scopeId: "",
  connections: [],
  workspaces: [],
  connectionId: "",
  preflight: null,
  scanResult: null,
  lastScanTime: null,
  scanDurationMs: null,
  scanStatus: "idle",
  activeScanStep: 0,
  scanLogs: "",
};

let activeUserId = null;
let state = { ...defaultState };
const listeners = new Set();

function storageKey(userId) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userId)}`;
}

function loadState(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const saved = raw ? { ...defaultState, ...JSON.parse(raw) } : { ...defaultState };
    if (["checking", "scanning"].includes(saved.scanStatus)) saved.scanStatus = "idle";
    return saved;
  } catch {
    return { ...defaultState };
  }
}

function persist() {
  if (!activeUserId) return;
  localStorage.setItem(
    storageKey(activeUserId),
    JSON.stringify({
      scopeType: state.scopeType,
      scopeId: state.scopeId,
      connectionId: state.connectionId,
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

export function activateUser(userId) {
  if (activeUserId === userId) return;
  sessionEpoch += 1;
  activeUserId = userId;
  state = { ...defaultState, ...loadState(userId) };
  listeners.forEach(listener => listener(state));
}

export function deactivateUser() {
  sessionEpoch += 1;
  activeUserId = null;
  state = { ...defaultState };
  listeners.forEach(listener => listener(state));
}

export function patchState(partial) {
  state = { ...state, ...partial };
  try { persist(); } catch { /* Keep the app usable when storage is full or unavailable. */ }
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
        project: lb.project_id || projectId,
        loadBalancer: lbName,
        forwardingRule,
        backendService: "—",
        cloudArmorPolicy: "No Policy",
        status: "UNPROTECTED",
        lastDetected: lb.lastScanTime || scanResult.lastScanTime || new Date().toISOString(),
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
        project: lb.project_id || projectId,
        loadBalancer: lbName,
        forwardingRule,
        backendService: backend?.name || "unknown",
        cloudArmorPolicy: hasPolicy ? policy.name : "No Policy",
        status: hasPolicy ? "PROTECTED" : "UNPROTECTED",
        lastDetected: lb.lastScanTime || scanResult.lastScanTime || new Date().toISOString(),
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

let sessionEpoch = 0;
export const getSessionEpoch = () => sessionEpoch;

export function resetState() {
  sessionEpoch += 1;
  if (activeUserId) {
    try { localStorage.removeItem(storageKey(activeUserId)); } catch { /* Storage may be disabled. */ }
  }
  activeUserId = null;
  state = { ...defaultState };
  listeners.forEach(listener => listener(state));
}

export function selectCloudConnection(connectionId, { preserveResults = false } = {}) {
  if (connectionId === state.connectionId) return;
  sessionEpoch += 1;
  patchState({
    connectionId,
    scopeId: '',
    preflight: null,
    scanLogs: '',
    ...(!preserveResults && {
      scanResult: null,
      scanStatus: 'idle',
      lastScanTime: null,
      scanDurationMs: null,
    }),
  });
}
