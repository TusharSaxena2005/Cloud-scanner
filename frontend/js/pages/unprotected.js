import { flattenBackends, getState } from "../store.js";
import { escapeHtml, formatDateTime, renderHierarchyDrawer } from "../utils.js";

export function renderUnprotected(root) {
  const state = getState();
  const rows = flattenBackends({
    ...state.scanResult,
    lastScanTime: state.lastScanTime,
  });

  const protectedCount = rows.filter((r) => r.status === "PROTECTED").length;
  const unprotectedCount = rows.filter((r) => r.status === "UNPROTECTED").length;

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Unprotected Backends</h1>
        <p>Public backend services behind external load balancers without an attached Cloud Armor policy.</p>
      </div>
    </div>

    ${
      !rows.length
        ? `<section class="panel empty-state"><span class="empty-symbol" aria-hidden="true">◇</span><h2>No scan results yet</h2><p>Run a scan to explore your Google Cloud resources and their protection.</p><a class="btn primary" href="#/scanner">Go to scanner</a></section>`
        : `
          <section class="panel">
            <div class="filter-row">
              <input id="backend-search" type="search" placeholder="Search backends, LBs, projects..." />
              <select id="project-filter"><option value="">All Projects</option>${uniqueOptions(rows, "project")}</select>
              <select id="lb-filter"><option value="">All Load Balancers</option>${uniqueOptions(rows, "loadBalancer")}</select>
              <select id="status-filter">
                <option value="">All Statuses</option>
                <option value="PROTECTED">Protected</option>
                <option value="UNPROTECTED">Unprotected</option>
              </select>
            </div>
            <div class="metric-grid three">
              <div class="metric-card"><span>Total Public Backends</span><strong>${rows.length}</strong></div>
              <div class="metric-card success"><span>Protected</span><strong>${protectedCount}</strong></div>
              <div class="metric-card danger"><span>Unprotected</span><strong>${unprotectedCount}</strong></div>
            </div>
          </section>

          <section class="panel table-panel">
            <div class="table-wrap">
              <table class="data-table" id="backends-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Load Balancer</th>
                    <th>Forwarding Rule</th>
                    <th>Backend Service</th>
                    <th>Cloud Armor Policy</th>
                    <th>Status</th>
                    <th>Last Detected</th>
                  </tr>
                </thead>
                <tbody id="backends-body"></tbody>
              </table>
            </div>
          </section>
        `
    }
  `;

  if (!rows.length) return;

  const tbody = root.querySelector("#backends-body");
  const filters = {
    search: root.querySelector("#backend-search"),
    project: root.querySelector("#project-filter"),
    lb: root.querySelector("#lb-filter"),
    status: root.querySelector("#status-filter"),
  };

  function renderTable() {
    const filtered = rows.filter((row) => {
      const q = filters.search.value.toLowerCase();
      const matchesSearch =
        !q ||
        [row.project, row.loadBalancer, row.forwardingRule, row.backendService, row.cloudArmorPolicy]
          .join(" ")
          .toLowerCase()
          .includes(q);
      const matchesProject = !filters.project.value || row.project === filters.project.value;
      const matchesLb = !filters.lb.value || row.loadBalancer === filters.lb.value;
      const matchesStatus = !filters.status.value || row.status === filters.status.value;
      return matchesSearch && matchesProject && matchesLb && matchesStatus;
    });

    tbody.innerHTML = filtered
      .map(
        (row) => `
          <tr data-backend="${escapeHtml(row.backendService)}" class="clickable-row">
            <td>${escapeHtml(row.project)}</td>
            <td>${escapeHtml(row.loadBalancer)}</td>
            <td><code>${escapeHtml(row.forwardingRule)}</code></td>
            <td><code>${escapeHtml(row.backendService)}</code></td>
            <td>${escapeHtml(row.cloudArmorPolicy)}</td>
            <td><span class="status-pill ${row.status === "PROTECTED" ? "ready" : "not-ready"}">${row.status}</span></td>
            <td>${formatDateTime(row.lastDetected)}</td>
          </tr>
        `
      )
      .join("");

    tbody.querySelectorAll(".clickable-row").forEach((tr, index) => {
      tr.onclick = () => renderHierarchyDrawer(filtered[index]);
    });
  }

  Object.values(filters).forEach((el) => el.addEventListener("input", renderTable));
  renderTable();
}

function uniqueOptions(rows, key) {
  return [...new Set(rows.map((row) => row[key]))]
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
}
