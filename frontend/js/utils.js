export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function formatDuration(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function statusClass(status) {
  return status.toLowerCase().replaceAll(" ", "-");
}

let drawerTrigger = null;

export function openDrawer(title, html) {
  drawerTrigger = document.activeElement;
  document.getElementById("drawer-title").textContent = title;
  document.getElementById("drawer-body").innerHTML = html;
  document.getElementById("detail-drawer").classList.remove("hidden");
  document.getElementById("drawer-backdrop").classList.remove("hidden");
  document.getElementById("app").inert = true;
  document.getElementById("drawer-close").focus();
}

export function closeDrawer() {
  document.getElementById("detail-drawer").classList.add("hidden");
  document.getElementById("drawer-backdrop").classList.add("hidden");
  document.getElementById("app").inert = false;
  if (drawerTrigger?.isConnected) drawerTrigger.focus();
  drawerTrigger = null;
}

export function bindDrawerClose() {
  document.addEventListener("keydown", event => {
    const drawer = document.getElementById("detail-drawer");
    if (drawer.classList.contains("hidden")) return;
    if (event.key === "Escape") closeDrawer();
    if (event.key === "Tab") {
      const items = [...drawer.querySelectorAll('button, a[href], input, [tabindex="0"]')];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.getElementById("drawer-close").onclick = closeDrawer;
  document.getElementById("drawer-backdrop").onclick = closeDrawer;
}

export function renderHierarchyDrawer(row) {
  const lb = row.hierarchy;
  const chain = [
    ["Project", row.project],
    ["Load Balancer", lb.forwarding_rule?.name],
    ["Forwarding Rule", lb.forwarding_rule?.name],
    ["Target Proxy", lb.target_proxy?.name],
    ["URL Map", lb.url_map?.name],
    ["Backend Service", row.backendNode?.backend_service?.name || row.backendService],
    [
      "Cloud Armor Policy",
      row.backendNode?.security_policy?.name || "NONE",
    ],
  ];

  openDrawer(
    `Backend: ${row.backendService}`,
    `
      <div class="drawer-type">Backend service</div>
      <div class="drawer-status ${statusClass(row.status)}">${escapeHtml(row.status)}</div>
      <h3 class="drawer-section-title">Resource hierarchy</h3>
      <div class="drawer-chain">
        ${chain
          .map(
            ([label, value], index) => `
              <div class="drawer-chain-item">
                <span class="drawer-chain-label">${escapeHtml(label)}</span>
                <span class="drawer-chain-value">${escapeHtml(value || "—")}</span>
                ${index < chain.length - 1 ? '<span class="drawer-chain-arrow">↓</span>' : ""}
              </div>
            `
          )
          .join("")}
      </div>
    `
  );
}

export function renderResourceDrawer(type, name, meta) {
  let fields = [];
  try {
    const parsed = JSON.parse(meta);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = Object.entries(parsed);
  } catch { /* Resource metadata can also be a plain value or URL. */ }
  const field = (label, value) => `<div class="resource-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "—"))}</dd></div>`;
  const status = meta.startsWith("PROTECTED") ? "protected" : meta === "UNPROTECTED" ? "unprotected" : "";
  openDrawer(name, `<div class="drawer-type">${escapeHtml(type)}</div>
    ${status ? `<div class="drawer-status ${status}">${status.toUpperCase()}</div>` : ""}
    <h3 class="drawer-section-title">Resource overview</h3>
    <dl class="resource-fields">${field("Name", name)}${field("Resource type", type)}</dl>
    <h3 class="drawer-section-title">Details</h3>
    ${fields.length ? `<dl class="resource-fields">${fields.map(([key, value]) => field(key.replaceAll("_", " "), value)).join("")}</dl>` : meta ? `<div class="resource-details">${escapeHtml(meta)}</div>` : '<p class="drawer-empty">No additional details are available for this resource.</p>'}`);
}
