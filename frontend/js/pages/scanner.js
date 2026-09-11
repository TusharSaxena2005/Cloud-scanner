import { streamPermissions, streamScan } from "../api.js";
import { permissionReason } from "../permissions.js";
import { getState, patchState, scanSummary } from "../store.js";
import { escapeHtml as esc, formatDateTime, formatDuration } from "../utils.js";

export function renderScanner(root) {
  const state = getState();
  const busy = ["checking", "scanning"].includes(state.scanStatus);
  const ready = state.preflight?.all_permissions_granted;
  const unsupported = state.scopeType !== "project";
  const missing = [...(state.preflight?.missing_permissions || []), ...(state.preflight?.invalid_permissions || [])];
  const summary = state.scanResult ? scanSummary(state.scanResult) : null;
  const metric = (label, value) => `<div class="metric-card"><span>${esc(label)}</span><strong>${esc(String(value ?? "—"))}</strong></div>`;
  root.innerHTML = `
    <div class="page-header"><span class="eyebrow">SECURITY WORKSPACE / SCANNER</span><h1>Cloud Armor overview</h1><p>Connect a GCP project, verify permissions, and discover your Cloud Armor coverage.</p></div>
    <section class="panel"><div class="panel-header"><div><h2>Connect to Google Cloud</h2><p class="panel-subtitle">Choose a project and verify access to get started.</p></div><span class="quiet-badge">Read-only scan</span></div>
      <div class="form-grid"><label><span>GCP scope type</span><select id="scope-type" ${busy ? "disabled" : ""}>${["project", "folder", "organization"].map(type => `<option value="${type}" ${state.scopeType === type ? "selected" : ""}>${type[0].toUpperCase() + type.slice(1)}</option>`).join("")}</select></label>
      <label><span>Project ID</span><input id="scope-id" placeholder="my-gcp-project" value="${esc(state.scopeId)}" ${busy ? "disabled" : ""} /></label></div>
      ${unsupported ? '<p class="panel-note warn">Folder and organization scans are not yet supported. Choose Project.</p>' : ""}
      <div class="info-row"><span class="info-label">Service account</span><code>${esc(state.serviceAccount?.email || "Loading...")}</code></div>
      <div class="action-row"><button id="check-permissions-btn" class="btn secondary" ${busy || unsupported ? "disabled" : ""}>${state.scanStatus === "checking" ? "Checking permissions..." : "Check permissions"}</button></div>
      <pre id="scanner-log" class="inline-log ${state.scanLogs ? "" : "hidden"}" aria-label="Scan activity">${esc(state.scanLogs || "")}</pre>
    </section>
    ${state.preflight ? `<section class="panel" id="permission-panel"><div class="panel-header"><h2>Permission status</h2><span class="status-pill ${ready ? "ready" : "not-ready"}">${ready ? "READY" : "NOT READY"}</span></div><div class="metric-grid four">${metric("Service account", state.preflight.service_account_email || state.serviceAccount?.email)}${metric("Scope", state.scopeId)}${metric("Granted", (state.preflight.permissions || []).filter(p => p.status === "GRANTED").length)}${metric("Missing", missing.length)}</div>${missing.length ? `<div class="warning-panel"><h3>Missing permissions</h3><ul class="warning-list">${missing.map(p => `<li><code>${esc(p)}</code><p>${esc(permissionReason(p))}</p></li>`).join("")}</ul></div>` : `<p class="panel-note">${ready ? "All required permissions are granted. You can start a scan." : "Permission verification is incomplete. Check access and try again."}</p>`}</section>` : ""}
    <section class="panel"><div class="panel-header"><div><h2>Security scan</h2><p class="panel-subtitle">Discover public backends and inspect Cloud Armor coverage.</p></div><span class="status-pill ${esc(state.scanStatus)}">${esc(state.scanStatus.toUpperCase())}</span></div>
      <div class="metric-grid three compact">${metric("Last scan", formatDateTime(state.lastScanTime))}${metric("Duration", formatDuration(state.scanDurationMs))}${metric("Status", state.scanResult?.message || "No scan results yet")}</div>
      <div class="action-row"><button id="start-scan-btn" class="btn primary large" ${!ready || busy || unsupported ? "disabled" : ""}>${state.scanStatus === "scanning" ? "Scanning..." : "Start scan"}</button></div>
      ${!ready ? '<p class="panel-note">Check project permissions to enable scanning.</p>' : ""}
      ${state.scanStatus === "scanning" ? '<div class="scan-pipeline" role="status"><div class="scan-step active"><span class="scan-step-dot"></span>Discovering resources and checking Cloud Armor policies. Follow progress in the activity log above.</div></div>' : ""}
      ${summary ? `<div class="metric-grid four" style="margin-top:20px">${metric("Load balancers", summary.loadBalancers)}${metric("Backend services", summary.backendServices)}${metric("Protected backends", summary.protectedBackends)}${metric("Unprotected backends", summary.unprotectedBackends)}</div><div class="action-row"><a class="btn ghost" href="#/unprotected">View backends</a><a class="btn ghost" href="#/flow">Explore traffic flow</a></div>` : ""}
    </section>`;
  const scope = root.querySelector("#scope-type");
  const input = root.querySelector("#scope-id");
  scope.onchange = () => { patchState({ scopeType: scope.value, preflight: null }); renderScanner(root); };
  input.oninput = () => {
    input.setCustomValidity("");
    patchState({ scopeId: input.value.trim(), preflight: null });
    root.querySelector("#permission-panel")?.remove();
    root.querySelector("#start-scan-btn").disabled = true;
  };
  async function run(scan) {
    if (busy || unsupported || (scan && !getState().preflight?.all_permissions_granted)) return;
    const id = input.value.trim();
    if (!id) { input.setCustomValidity("Enter a Google Cloud project ID."); input.reportValidity(); return; }
    const started = Date.now();
    patchState({ scopeId: id, scanStatus: scan ? "scanning" : "checking", scanLogs: "", ...(!scan ? { preflight: null } : {}) });
    renderScanner(root);
    const onScanner = () => !location.hash || location.hash === "#/scanner";
    const log = message => {
      const logs = getState().scanLogs + message + "\n";
      patchState({ scanLogs: logs });
      const el = root.querySelector("#scanner-log");
      if (el && onScanner()) { el.classList.remove("hidden"); el.textContent = logs; el.scrollTop = el.scrollHeight; }
    };
    try {
      const result = await (scan ? streamScan(id, log) : streamPermissions(id, log));
      if (scan) {
        const now = new Date().toISOString();
        patchState({ scanResult: { ...result, lastScanTime: now }, lastScanTime: now, scanDurationMs: Date.now() - started, scanStatus: result.status || "completed" });
      } else patchState({ preflight: result, scanStatus: "idle" });
    } catch (error) { log(`ERROR: ${error.message}`); patchState({ scanStatus: "failed", ...(scan ? { scanDurationMs: Date.now() - started } : {}) }); }
    if (onScanner()) renderScanner(root);
  }
  root.querySelector("#check-permissions-btn").onclick = () => run(false);
  root.querySelector("#start-scan-btn").onclick = () => run(true);
}
