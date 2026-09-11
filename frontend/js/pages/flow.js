import { getState } from "../store.js";
import { escapeHtml, renderResourceDrawer } from "../utils.js";

const ICONS = {
  project: "◆",
  loadBalancer: "⬡",
  forwardingRule: "⇄",
  targetProxy: "🔒",
  urlMap: "☷",
  backendService: "▣",
  securityPolicy: "🛡",
};

export function renderFlow(root) {
  const state = getState();
  const scan = state.scanResult;

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Load Balancer Flow</h1>
        <p>Follow the waterfall from project to Cloud Armor policy. Expand a resource to reveal the next step below and to the right.</p>
      </div>
    </div>

    ${
      !scan?.load_balancers?.length
        ? `<section class="panel empty-state"><span class="empty-symbol" aria-hidden="true">◇</span><h2>No scan results yet</h2><p>Run a scan to explore your Google Cloud resources and their protection.</p><a class="btn primary" href="#/scanner">Go to scanner</a></section>`
        : `
          <section class="panel flow-controls">
            <div class="filter-row">
              <input id="flow-search" type="search" placeholder="Search resource names..." />
              <select id="flow-project-filter"><option value="">All Projects</option><option value="${escapeHtml(scan.project_id)}">${escapeHtml(scan.project_id)}</option></select>
              <select id="flow-lb-filter"><option value="">All Load Balancers</option>${scan.load_balancers.map((lb) => `<option value="${escapeHtml(lb.forwarding_rule.name)}">${escapeHtml(lb.forwarding_rule.name)}</option>`).join("")}</select>
              <select id="flow-protection-filter">
                <option value="">All Protection States</option>
                <option value="PROTECTED">Protected</option>
                <option value="UNPROTECTED">Unprotected</option>
              </select>
            </div>
            <div class="flow-toolbar">
              <button id="expand-all" class="btn ghost" type="button">Expand All</button>
              <button id="collapse-all" class="btn ghost" type="button">Collapse All</button>
            </div>
          </section>

          <section class="panel flow-panel">
            <div id="flow-viewport" class="flow-viewport" tabindex="0" role="region" aria-label="Resource hierarchy; scroll to explore">
              <div id="flow-canvas" class="flow-canvas"></div>
            </div>
          </section>
        `
    }
  `;

  if (!scan?.load_balancers?.length) return;

  const canvas = root.querySelector("#flow-canvas");
  const filters = {
    search: root.querySelector("#flow-search"),
    lb: root.querySelector("#flow-lb-filter"),
    protection: root.querySelector("#flow-protection-filter"),
  };

  function buildTreeHtml() {
    const search = filters.search.value.toLowerCase();
    const lbFilter = filters.lb.value;
    const protectionFilter = filters.protection.value;

    const projectNode = `
      <div class="tree-node project-node" data-type="project" data-name="${escapeHtml(scan.project_id)}">
        <div class="node-icon">${ICONS.project}</div>
        <div class="node-body">
          <span class="node-type">Project</span>
          <strong class="node-name">${escapeHtml(scan.project_id)}</strong>
        </div>
      </div>
    `;

    const lbTrees = scan.load_balancers
      .filter((lb) => !lbFilter || lb.forwarding_rule.name === lbFilter)
      .map((lb) => renderLoadBalancerTree(lb, scan.project_id, search, protectionFilter))
      .filter(Boolean)
      .join("");

    canvas.innerHTML = `
      <div class="tree-root waterfall-root">
        ${waterfallBranch(projectNode, lbTrees || '<p class="empty-inline">No load balancers match the current filters.</p>', "project")}
      </div>
    `;

    bindNodeClicks(canvas);
  }

  function bindNodeClicks(container) {
    container.querySelectorAll(".tree-node").forEach((node) => {
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); node.click(); } };
      node.onclick = (event) => {
        node.focus();
        event.stopPropagation();
        const type = node.dataset.type;
        const name = node.dataset.name || "Resource";
        const meta = node.dataset.meta || "";
        renderResourceDrawer(type, name, meta);
      };
    });


  }

  buildTreeHtml();

  Object.values(filters).forEach((el) => el.addEventListener("input", buildTreeHtml));
  root.querySelector("#expand-all").onclick = () => {
    canvas.querySelectorAll(".waterfall-branch").forEach((branch) => { branch.open = true; });
  };
  root.querySelector("#collapse-all").onclick = () => {
    canvas.querySelectorAll(".waterfall-branch").forEach((branch) => { branch.open = false; });
  };

}

function renderLoadBalancerTree(lb, projectId, search, protectionFilter) {
  const lbName = lb.forwarding_rule.name;
  const backends = lb.backend_services || [];
  const hasUnprotected = backends.some((b) => !b.security_policy?.name);
  const hasProtected = backends.some((b) => b.security_policy?.name);

  if (protectionFilter === "PROTECTED" && !hasProtected) return "";
  if (protectionFilter === "UNPROTECTED" && !hasUnprotected) return "";

  const haystack = [
    projectId,
    lbName,
    lb.forwarding_rule?.name,
    lb.target_proxy?.name,
    lb.url_map?.name,
    ...backends.map((b) => b.backend_service?.name),
    ...backends.map((b) => b.security_policy?.name),
  ]
    .join(" ")
    .toLowerCase();

  if (search && !haystack.includes(search)) return "";

  const backendTrees = backends
    .map((entry) => renderBackendBranch(entry, protectionFilter))
    .filter(Boolean)
    .join("");

  const backendLevel = backendTrees || renderUnprotectedBackendPlaceholder();
  const urlMapLevel = waterfallBranch(node("urlMap", lb.url_map?.name || "—", "URL Map", lb.url_map?.self_link), backendLevel, "backends");
  const proxyLevel = waterfallBranch(node("targetProxy", lb.target_proxy?.name || "—", lb.target_proxy?.resource_type || "Target Proxy", lb.target_proxy?.self_link), urlMapLevel, "URL map");
  const ruleLevel = waterfallBranch(node("forwardingRule", lbName, "Forwarding Rule", JSON.stringify(lb.forwarding_rule.details || {}, null, 2)), proxyLevel, "target proxy");
  return waterfallBranch(node("loadBalancer", lbName, "External HTTP(S) LB", lb.forwarding_rule?.details?.load_balancing_scheme), ruleLevel, "forwarding rule");
}

function waterfallBranch(resource, children, label) {
  return `<div class="waterfall-level">${resource}<details class="waterfall-branch" open><summary aria-label="Expand or collapse ${escapeHtml(label)}" title="Expand or collapse ${escapeHtml(label)}"><span aria-hidden="true">›</span></summary><div class="waterfall-children">${children}</div></details></div>`;
}

function renderBackendBranch(entry, protectionFilter) {
  const backend = entry.backend_service;
  const policy = entry.security_policy;
  const protectedStatus = policy?.name ? "PROTECTED" : "UNPROTECTED";

  if (protectionFilter && protectionFilter !== protectedStatus) return "";

  const policyNode = policy?.name
    ? node("securityPolicy", policy.name, "Cloud Armor", `PROTECTED\n${policy.self_link || ""}`, "protected")
    : node("securityPolicy", "Not attached", "Cloud Armor", "UNPROTECTED", "unprotected");
  return waterfallBranch(node("backendService", backend?.name || "—", "Backend Service", backend?.self_link), policyNode, "Cloud Armor policy");
}

function renderUnprotectedBackendPlaceholder() {
  return `
    <div class="tree-node backend-node unprotected" data-type="Backend Service" data-name="NONE" data-meta="No backend services resolved">
      <div class="node-icon">${ICONS.backendService}</div>
      <div class="node-body">
        <span class="node-type">Backend Service</span>
        <strong class="node-name">Not resolved</strong>
      </div>
    </div>
  `;
}

function node(type, name, label, meta = "", extraClass = "") {
  return `
    <div class="tree-node ${extraClass}" data-type="${escapeHtml(label)}" data-name="${escapeHtml(name || "—")}" data-meta="${escapeHtml(meta || "")}">
      <div class="node-icon">${ICONS[type] || "•"}</div>
      <div class="node-body">
        <span class="node-type">${escapeHtml(label)}</span>
        <strong class="node-name">${escapeHtml(name || "—")}</strong>
      </div>
    </div>
  `;
}
